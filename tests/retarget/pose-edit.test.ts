import { describe, expect, it } from "vitest";
import { Document, WebIO } from "@gltf-transform/core";
import { Quaternion, Vector3 } from "three";
import { bakeHumanoidPoseEdits, sampleHumanoidTargetPose, assertHumanoidPoseEdit, type HumanoidPoseEdit } from "@/retarget/pose-edit";
import { createCanonicalHumanoidMotionClip, type TargetBoundSolvedHumanoidMotionClip, type HumanoidBoneName } from "@/retarget";
import { solveHumanoidMotion } from "@/solvers";
import { createGLTFHumanoidRigSignature, bindCanonicalClipToGLTFTarget } from "@/export/gltf-target-binding";
import { exportVRMA } from "@/export/vrma";
import { exportAnimatedGLB } from "@/export/avatar-glb";
import { validateMotionExportSemantics, validateMotionExportReload, validateAvatarExportReload, validateAvatarExportSemantics } from "@/export/reload-validation";
import { DEFAULT_PROCESSING_BUDGET } from "@/processing-budget";
import { executeRetargetJob } from "@/jobs/execute-retarget-job";

function fixture(height=1, angle=0) {
  const doc=new Document(), scene=doc.createScene("target");
  doc.getRoot().setDefaultScene(scene);
  const hips=doc.createNode("hips").setTranslation([0,height,0]); scene.addChild(hips);
  const nodes=new Map<HumanoidBoneName,ReturnType<Document["createNode"]>>([["hips",hips]]);
  for (const side of ["left","right"] as const) for (const limb of ["Arm","Leg"] as const) {
    const sign=side==="left"?1:-1;
    const upper=doc.createNode(side+"Upper"+limb).setTranslation(limb==="Arm"?[sign*.2*height,.5*height,0]:[sign*.1*height,0,0]);
    if (limb==="Arm") upper.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),sign*angle).toArray());
    const lower=doc.createNode(side+"Lower"+limb).setTranslation(limb==="Arm"?[sign*.4*height,0,0]:[0,-.4*height,0]);
    const endName=side+(limb==="Arm"?"Hand":"Foot") as HumanoidBoneName;
    const end=doc.createNode(endName).setTranslation(limb==="Arm"?[sign*.4*height,0,0]:[0,-.4*height,0]);
    hips.addChild(upper);upper.addChild(lower);lower.addChild(end);
    nodes.set((side+"Upper"+limb) as HumanoidBoneName,upper);nodes.set((side+"Lower"+limb) as HumanoidBoneName,lower);nodes.set(endName,end);
  }
  const source=createCanonicalHumanoidMotionClip({schemaVersion:2,name:"pose",duration:2,fps:30,source:{kind:"vrma",filename:"pose.vrma"},
    metadata:{rootTranslationSpace:"offset-meters",restHipsHeight:height},
    tracks:[...nodes.keys()].map(bone=>({bone,path:"rotation",times:[0,1,2],values:[0,0,0,1,0,0,0,1,0,0,0,1]}))});
  const clip:TargetBoundSolvedHumanoidMotionClip={...solveHumanoidMotion({motion:source,mapping:{enabled:false,footCleanup:false,chainPreset:"full-body",boneMap:{}}}),
    target:{kind:"gltf-humanoid",filename:"target.glb",profile:"generic-gltf-humanoid",restHipsHeight:height,
      rigSignature:createGLTFHumanoidRigSignature(nodes,"generic-gltf-humanoid")}};
  const edit:HumanoidPoseEdit={schemaVersion:1,restPoseVersion:1,rigSignature:clip.target.rigSignature,corrections:[
    {kind:"fk",enabled:true,bone:"leftUpperArm",rotationDegrees:[0,0,30],startSeconds:.5,endSeconds:1.5,fadeInSeconds:.2,fadeOutSeconds:.2,weight:1}]};
  return {doc,nodes,clip,source,edit};
}
describe("target-bound pose corrections",()=>{
  it.each([[1,0],[1.8,-.5]])("bakes local FK across T/A pose and height %j", (height,angle)=>{
    const {clip,edit,nodes}=fixture(height,angle), before=structuredClone(clip);
    const result=bakeHumanoidPoseEdits(clip,edit);
    expect(clip).toEqual(before);expect(bakeHumanoidPoseEdits(clip,edit)).toEqual(result);
    for(const t of [0,.2,.5,1.5,1.8,2]) expect(sampleHumanoidTargetPose(result,t).leftHand).toEqual(sampleHumanoidTargetPose(clip,t).leftHand);
    const bound=bindCanonicalClipToGLTFTarget(result,nodes);
    const track=bound.tracks.find(t=>t.bone==="leftUpperArm")!, i=track.times.indexOf(1);
    const actual=new Quaternion().fromArray(track.values,i*4);
    const expected=new Quaternion(...nodes.get("leftUpperArm")!.getRotation()).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/6));
    expect(actual.angleTo(expected)).toBeLessThan(1e-4);
    expect(sampleHumanoidTargetPose(result,1).hips).toEqual(sampleHumanoidTargetPose(clip,1).hips);
    expect(bakeHumanoidPoseEdits(clip,{...edit,corrections:edit.corrections.map(c=>({...c,weight:0}))})).toBe(clip);
  });
  it.each(["leftHand","rightHand","leftFoot","rightFoot"] as const)("solves %s toward target with pole and warnings",(bone)=>{
    const {clip,edit}=fixture();
    const rest=sampleHumanoidTargetPose(clip,1)[bone]!;
    const target:[number,number,number]=[rest[0]*.75,rest[1]+.12,.15];
    edit.corrections=[{...edit.corrections[0]!,kind:"ik",bone,target,pole:[0,1,2]} as typeof edit.corrections[number]];
    delete (edit.corrections[0] as unknown as Record<string,unknown>).rotationDegrees;
    const result=bakeHumanoidPoseEdits(clip,edit);
    expect(new Vector3(...sampleHumanoidTargetPose(result,1)[bone]!).distanceTo(new Vector3(...target))).toBeLessThan(1e-4);
    const unreachable=structuredClone(edit);if(unreachable.corrections[0]!.kind==="ik")unreachable.corrections[0]!.target=[100,100,100];
    expect(bakeHumanoidPoseEdits(clip,unreachable).metadata?.poseEdit?.warnings.some(w=>w.code==="IK_UNREACHABLE")).toBe(true);
  });
  it("rejects invalid contracts, target changes, repeated baking, unmapped chains and budgets",()=>{
    const {clip,edit}=fixture();
    expect(()=>assertHumanoidPoseEdit({...edit,corrections:[{...edit.corrections[0],weight:NaN}]},2)).toThrow();
    expect(()=>bakeHumanoidPoseEdits(clip,{...edit,rigSignature:edit.rigSignature+" "})).toThrow(expect.objectContaining({code:"TARGET_RIG_MISMATCH"}));
    expect(()=>bakeHumanoidPoseEdits(bakeHumanoidPoseEdits(clip,edit),edit)).toThrow();
    expect(()=>bakeHumanoidPoseEdits(clip,{...edit,corrections:[{...edit.corrections[0]!,bone:"head"}]})).toThrow();
    expect(()=>bakeHumanoidPoseEdits(clip,edit,{...DEFAULT_PROCESSING_BUDGET,maxGeneratedValues:10})).toThrow();
  });
  it("runs through jobs and reloads VRMA and target GLB with semantic evidence",async()=>{
    const {clip,edit,doc}=fixture(1.5,-.3);
    edit.corrections.push({kind:"ik",enabled:true,bone:"leftFoot",target:[.12,.4,.15],pole:[0,1,1],startSeconds:.5,endSeconds:1.5,fadeInSeconds:.2,fadeOutSeconds:.2,weight:1});
    const result=await executeRetargetJob({schemaVersion:2,jobId:"pose",task:{type:"pose-humanoid",motion:clip,edit}}) as TargetBoundSolvedHumanoidMotionClip;
    expect(result).toEqual(bakeHumanoidPoseEdits(clip,edit));
    const vrma=await exportVRMA(result);
    expect((await validateMotionExportReload("vrma",vrma)).ok).toBe(true);
    expect((await validateMotionExportSemantics("vrma",vrma,result))?.ok).toBe(true);
    const bytes=await new WebIO().writeBinary(doc);
    const glb=await exportAnimatedGLB({avatarFile:new File([new Uint8Array(bytes).buffer],"target.glb"),avatarFormatId:"gltf-humanoid",clip:result});
    expect((await validateAvatarExportReload("animated-glb",glb)).ok).toBe(true);
    const semantic=await validateAvatarExportSemantics("animated-glb",glb,result);
    expect(semantic?.ok,JSON.stringify(semantic)).toBe(true);
  });
});
