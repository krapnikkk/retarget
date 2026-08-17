import { Quaternion } from "three";
import type { Accessor } from "@gltf-transform/core";
import type { MotionTrackPath } from "@/retarget";
import {
  DEFAULT_PARSE_BUDGET,
  ParseDomainError,
  assertCountWithinBudget,
} from "./parse-budget";

const CUBIC_TRANSLATION_ERROR_METERS = 0.0005;
const CUBIC_ROTATION_ERROR_RADIANS = (0.1 * Math.PI) / 180;
const MAX_ADAPTIVE_DEPTH = 6;
const MAX_CUBIC_SAMPLES_PER_SOURCE_INTERVAL = 2 ** MAX_ADAPTIVE_DEPTH + 1;
const MIN_ADAPTIVE_INTERVAL_SECONDS = 1e-6;
const STEP_TRANSITION_EPSILON_SECONDS = 1e-6;

export function readGLTFAnimationTrack({
  filename,
  input,
  interpolation,
  output,
  path,
  section,
}: {
  filename: string;
  input: Accessor;
  interpolation: string;
  output: Accessor;
  path: MotionTrackPath;
  section: string;
}) {
  if (input.getType() !== "SCALAR") {
    throw new ParseDomainError(
      "GLTF_INPUT_TYPE_MISMATCH",
      "glTF animation input accessor must be SCALAR",
      { filename, section },
    );
  }
  const expectedOutputType = path === "rotation" ? "VEC4" : "VEC3";
  if (output.getType() !== expectedOutputType) {
    throw new ParseDomainError(
      "GLTF_OUTPUT_TYPE_MISMATCH",
      `glTF ${path} output accessor must be ${expectedOutputType}`,
      { filename, section },
    );
  }
  assertCountWithinBudget(
    input.getCount(),
    DEFAULT_PARSE_BUDGET.maxSamplesPerTrack,
    `${section} source samples`,
    { filename, section },
  );
  const sourceTimes = readScalarAccessor(input, filename, section);
  validateTimes(sourceTimes, filename, section);
  if (sourceTimes.length === 0) {
    return { times: [], values: [], resampled: false };
  }
  const cubic = interpolation === "CUBICSPLINE";
  const step = interpolation === "STEP";
  if (!cubic && !step && interpolation !== "LINEAR") {
    throw new ParseDomainError(
      "GLTF_INTERPOLATION_UNSUPPORTED",
      `glTF interpolation ${interpolation} is unsupported`,
      { filename, section },
    );
  }
  const expectedOutputCount = sourceTimes.length * (cubic ? 3 : 1);
  if (output.getCount() !== expectedOutputCount) {
    throw new ParseDomainError(
      "GLTF_OUTPUT_COUNT_MISMATCH",
      "glTF animation output count does not match its interpolation layout",
      {
        filename,
        section,
        declared: output.getCount(),
        limit: expectedOutputCount,
      },
    );
  }
  if (path === "rotation") {
    validateQuaternionKeyValues({
      cubic,
      filename,
      output,
      section,
      sourceCount: sourceTimes.length,
    });
  }
  if (cubic) {
    validateAccessorElements(output, path, filename, section);
  }

  if (!cubic && !step) {
    return {
      times: sourceTimes,
      values: ensureQuaternionContinuity(
        readElements(output, path, sourceTimes.length, 0, 1, filename, section),
        path,
      ),
      resampled: false,
    };
  }

  const { times, values } = cubic
    ? resampleCubicSpline({ filename, output, path, section, sourceTimes })
    : resampleStep({ filename, output, path, section, sourceTimes });
  return {
    times,
    values: ensureQuaternionContinuity(values, path),
    resampled: true,
  };
}

function validateQuaternionKeyValues({
  cubic,
  filename,
  output,
  section,
  sourceCount,
}: {
  cubic: boolean;
  filename: string;
  output: Accessor;
  section: string;
  sourceCount: number;
}) {
  const element: number[] = [];
  for (let index = 0; index < sourceCount; index += 1) {
    output.getElement(cubic ? index * 3 + 1 : index, element);
    const quaternion = element.slice(0, 4);
    if (
      quaternion.some((value) => !Number.isFinite(value)) ||
      Math.hypot(...quaternion) <= 1e-12
    ) {
      throw new ParseDomainError(
        "GLTF_INVALID_OUTPUT",
        `glTF animation quaternion ${index} must be finite and non-zero`,
        { filename, section },
      );
    }
  }
}

function readScalarAccessor(accessor: Accessor, filename: string, section: string) {
  const values: number[] = [];
  for (let index = 0; index < accessor.getCount(); index += 1) {
    const value = accessor.getScalar(index);
    if (!Number.isFinite(value)) {
      throw new ParseDomainError(
        "GLTF_INVALID_TIME",
        `glTF animation time ${index} is not finite`,
        { filename, section },
      );
    }
    values.push(value);
  }
  return values;
}

function validateTimes(times: readonly number[], filename: string, section: string) {
  for (let index = 0; index < times.length; index += 1) {
    if ((times[index] ?? -1) < 0 || (index > 0 && times[index]! <= times[index - 1]!)) {
      throw new ParseDomainError(
        "GLTF_INVALID_TIME",
        "glTF animation times must be non-negative and strictly increasing",
        { filename, section },
      );
    }
  }
  const lastTime = times.at(-1) ?? 0;
  if (lastTime > DEFAULT_PARSE_BUDGET.maxDurationSeconds) {
    throw new ParseDomainError(
      "PARSE_BUDGET_EXCEEDED",
      "glTF animation duration exceeds the processing limit",
      {
        filename,
        section,
        declared: Math.ceil(lastTime),
        limit: DEFAULT_PARSE_BUDGET.maxDurationSeconds,
      },
    );
  }
}

function readElements(
  accessor: Accessor,
  path: MotionTrackPath,
  count: number,
  start: number,
  stride: number,
  filename: string,
  section: string,
) {
  const size = path === "rotation" ? 4 : 3;
  const values: number[] = [];
  const element: number[] = [];
  for (let index = 0; index < count; index += 1) {
    accessor.getElement(start + index * stride, element);
    for (let component = 0; component < size; component += 1) {
      const value = element[component] ?? 0;
      if (!Number.isFinite(value)) {
        throw new ParseDomainError(
          "GLTF_INVALID_OUTPUT",
          `glTF animation output ${index}.${component} is not finite`,
          { filename, section },
        );
      }
      values.push(value);
    }
  }
  return values;
}

function validateAccessorElements(
  accessor: Accessor,
  path: MotionTrackPath,
  filename: string,
  section: string,
) {
  const size = path === "rotation" ? 4 : 3;
  const element: number[] = [];
  for (let index = 0; index < accessor.getCount(); index += 1) {
    accessor.getElement(index, element);
    for (let component = 0; component < size; component += 1) {
      if (!Number.isFinite(element[component])) {
        throw new ParseDomainError(
          "GLTF_INVALID_OUTPUT",
          `glTF animation output ${index}.${component} is not finite`,
          { filename, section },
        );
      }
    }
  }
}

function sampleCubicSpline(
  output: Accessor,
  times: readonly number[],
  path: MotionTrackPath,
  time: number,
) {
  if (times.length <= 1 || time <= (times[0] ?? 0)) {
    return normalizeIfQuaternion(readElement(output, 1, path), path);
  }
  const lastIndex = times.length - 1;
  if (time >= times[lastIndex]!) {
    return normalizeIfQuaternion(readElement(output, lastIndex * 3 + 1, path), path);
  }
  const left = findSegment(times, time);
  const right = left + 1;
  const delta = times[right]! - times[left]!;
  const t = (time - times[left]!) / delta;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const value0 = readElement(output, left * 3 + 1, path);
  const tangent0 = readElement(output, left * 3 + 2, path);
  const value1 = readElement(output, right * 3 + 1, path);
  const tangent1 = readElement(output, right * 3, path);
  return normalizeIfQuaternion(
    value0.map(
      (value, component) =>
        h00 * value +
        h10 * delta * tangent0[component]! +
        h01 * value1[component]! +
        h11 * delta * tangent1[component]!,
    ),
    path,
  );
}

function resampleCubicSpline({
  filename,
  output,
  path,
  section,
  sourceTimes,
}: {
  filename: string;
  output: Accessor;
  path: MotionTrackPath;
  section: string;
  sourceTimes: readonly number[];
}) {
  const firstTime = sourceTimes[0]!;
  const times = [firstTime];
  const values = sampleCubicSpline(output, sourceTimes, path, firstTime);
  for (let index = 1; index < sourceTimes.length; index += 1) {
    const leftTime = sourceTimes[index - 1]!;
    const rightTime = sourceTimes[index]!;
    appendAdaptiveCubicInterval({
      depth: 0,
      filename,
      leftTime,
      leftValue: sampleCubicSpline(output, sourceTimes, path, leftTime),
      output,
      path,
      rightTime,
      rightValue: sampleCubicSpline(output, sourceTimes, path, rightTime),
      section,
      sourceTimes,
      times,
      values,
    });
    assertCountWithinBudget(
      times.length,
      DEFAULT_PARSE_BUDGET.maxSamplesPerTrack,
      `${section} adaptively resampled samples`,
      { filename, section },
    );
  }
  return { times, values };
}

function appendAdaptiveCubicInterval({
  depth,
  filename,
  leftTime,
  leftValue,
  output,
  path,
  rightTime,
  rightValue,
  section,
  sourceTimes,
  times,
  values,
}: {
  depth: number;
  filename: string;
  leftTime: number;
  leftValue: number[];
  output: Accessor;
  path: MotionTrackPath;
  rightTime: number;
  rightValue: number[];
  section: string;
  sourceTimes: readonly number[];
  times: number[];
  values: number[];
}) {
  const duration = rightTime - leftTime;
  const fractions = [0.25, 0.5, 0.75] as const;
  const exceedsError = fractions.some((fraction) => {
    const time = leftTime + duration * fraction;
    const actual = sampleCubicSpline(output, sourceTimes, path, time);
    const linear = interpolateSample(leftValue, rightValue, path, fraction);
    return sampleError(actual, linear, path) > (
      path === "rotation"
        ? CUBIC_ROTATION_ERROR_RADIANS
        : CUBIC_TRANSLATION_ERROR_METERS
    );
  });
  if (
    !exceedsError ||
    duration <= MIN_ADAPTIVE_INTERVAL_SECONDS
  ) {
    assertCountWithinBudget(
      times.length + 1,
      DEFAULT_PARSE_BUDGET.maxSamplesPerTrack,
      `${section} adaptively resampled samples`,
      { filename, section },
    );
    times.push(rightTime);
    values.push(...rightValue);
    return;
  }
  if (depth >= MAX_ADAPTIVE_DEPTH) {
    throw new ParseDomainError(
      "PARSE_BUDGET_EXCEEDED",
      "glTF cubic interpolation exceeds the per-interval format safety limit",
      {
        filename,
        section,
        declared: MAX_CUBIC_SAMPLES_PER_SOURCE_INTERVAL + 1,
        limit: MAX_CUBIC_SAMPLES_PER_SOURCE_INTERVAL,
      },
    );
  }
  const middleTime = leftTime + duration / 2;
  const middleValue = sampleCubicSpline(output, sourceTimes, path, middleTime);
  appendAdaptiveCubicInterval({
    depth: depth + 1,
    filename,
    leftTime,
    leftValue,
    output,
    path,
    rightTime: middleTime,
    rightValue: middleValue,
    section,
    sourceTimes,
    times,
    values,
  });
  appendAdaptiveCubicInterval({
    depth: depth + 1,
    filename,
    leftTime: middleTime,
    leftValue: middleValue,
    output,
    path,
    rightTime,
    rightValue,
    section,
    sourceTimes,
    times,
    values,
  });
}

function resampleStep({
  filename,
  output,
  path,
  section,
  sourceTimes,
}: {
  filename: string;
  output: Accessor;
  path: MotionTrackPath;
  section: string;
  sourceTimes: readonly number[];
}) {
  const times = [sourceTimes[0]!];
  const values = readElement(output, 0, path);
  for (let index = 1; index < sourceTimes.length; index += 1) {
    const previousTime = sourceTimes[index - 1]!;
    const time = sourceTimes[index]!;
    const epsilon = Math.min(
      STEP_TRANSITION_EPSILON_SECONDS,
      (time - previousTime) / 2,
    );
    const transitionStart = time - epsilon;
    if (transitionStart > times.at(-1)!) {
      times.push(transitionStart);
      values.push(...readElement(output, index - 1, path));
    }
    times.push(time);
    values.push(...readElement(output, index, path));
    assertCountWithinBudget(
      times.length,
      DEFAULT_PARSE_BUDGET.maxSamplesPerTrack,
      `${section} step-preserving samples`,
      { filename, section },
    );
  }
  return { times, values };
}

function interpolateSample(
  left: readonly number[],
  right: readonly number[],
  path: MotionTrackPath,
  alpha: number,
) {
  if (path === "rotation") {
    return new Quaternion(...(left as [number, number, number, number]))
      .slerp(new Quaternion(...(right as [number, number, number, number])), alpha)
      .normalize()
      .toArray();
  }
  return left.map(
    (value, index) => value + ((right[index] ?? value) - value) * alpha,
  );
}

function sampleError(
  actual: readonly number[],
  linear: readonly number[],
  path: MotionTrackPath,
) {
  if (path === "rotation") {
    return new Quaternion(...(actual as [number, number, number, number]))
      .angleTo(new Quaternion(...(linear as [number, number, number, number])));
  }
  return Math.hypot(
    (actual[0] ?? 0) - (linear[0] ?? 0),
    (actual[1] ?? 0) - (linear[1] ?? 0),
    (actual[2] ?? 0) - (linear[2] ?? 0),
  );
}

function readElement(accessor: Accessor, index: number, path: MotionTrackPath) {
  const size = path === "rotation" ? 4 : 3;
  const element: number[] = [];
  accessor.getElement(index, element);
  return Array.from({ length: size }, (_, component) => element[component] ?? 0);
}

function findSegment(times: readonly number[], time: number) {
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (times[middle]! <= time) low = middle;
    else high = middle - 1;
  }
  return low;
}

function normalizeIfQuaternion(values: number[], path: MotionTrackPath) {
  if (path !== "rotation") return values;
  return new Quaternion(...(values as [number, number, number, number]))
    .normalize()
    .toArray();
}

function ensureQuaternionContinuity(values: number[], path: MotionTrackPath) {
  if (path !== "rotation") return values;
  const output: number[] = [];
  let previous: Quaternion | null = null;
  for (let index = 0; index < values.length; index += 4) {
    const current = new Quaternion(
      values[index] ?? 0,
      values[index + 1] ?? 0,
      values[index + 2] ?? 0,
      values[index + 3] ?? 1,
    ).normalize();
    if (previous && previous.dot(current) < 0) {
      current.set(-current.x, -current.y, -current.z, -current.w);
    }
    output.push(...current.toArray());
    previous = current;
  }
  return output;
}
