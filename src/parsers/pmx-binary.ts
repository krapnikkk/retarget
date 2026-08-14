import {
  ParseDomainError,
  assertCountWithinBudget,
  type ParseBudget,
  resolveParseBudget,
} from "@/import/parse-budget";

export type PMXEncoding = "utf-8" | "utf-16le";

export type PMXConfig = {
  encoding: PMXEncoding;
  additionalUvCount: number;
  vertexIndexSize: number;
  textureIndexSize: number;
  materialIndexSize: number;
  boneIndexSize: number;
  morphIndexSize: number;
  rigidBodyIndexSize: number;
};

export function readPMXHeader(reader: PMXBinaryReader) {
  if (reader.readAscii(4) !== "PMX ") {
    throw new Error("PMX header is invalid.");
  }
  const version = reader.readFloat32();
  const configCount = reader.readUint8();
  if (Math.abs(version - 2) > 1e-4 && Math.abs(version - 2.1) > 1e-4) {
    throw new Error(`Unsupported PMX version: ${version}`);
  }
  if (configCount !== 8) {
    throw new Error(`PMX header config count must be 8; found ${configCount}.`);
  }
  const raw = Array.from({ length: configCount }, () => reader.readUint8());
  if (raw[0] !== 0 && raw[0] !== 1) {
    throw new Error(`PMX text encoding flag is invalid: ${raw[0]}.`);
  }
  if ((raw[1] ?? 0) > 4) {
    throw new Error(`PMX additional UV count is invalid: ${raw[1]}.`);
  }
  for (const [index, size] of raw.slice(2, 8).entries()) {
    if (size !== 1 && size !== 2 && size !== 4) {
      throw new Error(`PMX index size ${index} is invalid: ${size}.`);
    }
  }
  const config: PMXConfig = {
    encoding: raw[0] === 0 ? "utf-16le" : "utf-8",
    additionalUvCount: raw[1] ?? 0,
    vertexIndexSize: raw[2] ?? 4,
    textureIndexSize: raw[3] ?? 4,
    materialIndexSize: raw[4] ?? 4,
    boneIndexSize: raw[5] ?? 4,
    morphIndexSize: raw[6] ?? 4,
    rigidBodyIndexSize: raw[7] ?? 4,
  };
  return { version, config };
}

export type PMXVertexWeight = {
  joints: [number, number, number, number];
  weights: [number, number, number, number];
};

export function readPMXWeight(
  reader: PMXBinaryReader,
  boneIndexSize: number,
): PMXVertexWeight {
  const type = reader.readUint8();
  if (type === 0) {
    // BDEF1
    return {
      joints: [reader.readIndex(boneIndexSize), 0, 0, 0],
      weights: [1, 0, 0, 0],
    };
  }
  if (type === 1 || type === 3) {
    // BDEF2 / SDEF (SDEF is treated as BDEF2; C/R0/R1 vectors are skipped)
    const joint0 = reader.readIndex(boneIndexSize);
    const joint1 = reader.readIndex(boneIndexSize);
    const weight0 = reader.readFloat32();
    if (type === 3) {
      reader.skip(9 * 4);
    }
    validatePMXWeights([weight0, 1 - weight0]);
    return {
      joints: [joint0, joint1, 0, 0],
      weights: [weight0, 1 - weight0, 0, 0],
    };
  }
  if (type === 2 || type === 4) {
    // BDEF4 / QDEF
    const joints: [number, number, number, number] = [
      reader.readIndex(boneIndexSize),
      reader.readIndex(boneIndexSize),
      reader.readIndex(boneIndexSize),
      reader.readIndex(boneIndexSize),
    ];
    const weights: [number, number, number, number] = [
      reader.readFloat32(),
      reader.readFloat32(),
      reader.readFloat32(),
      reader.readFloat32(),
    ];
    validatePMXWeights(weights);
    return { joints, weights };
  }
  throw new Error(`Unsupported PMX vertex weight type: ${type}`);
}

function validatePMXWeights(weights: readonly number[]) {
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0 || weight > 1)) {
    throw new ParseDomainError(
      "PARSE_INVALID_NUMBER",
      "PMX vertex weights must be finite values within 0..1",
      { section: "vertex-weight" },
    );
  }
  const sum = weights.reduce((total, weight) => total + weight, 0);
  if (sum <= 0 || Math.abs(sum - 1) > 1e-4) {
    throw new ParseDomainError(
      "PARSE_INVALID_NUMBER",
      "PMX vertex weights must sum to one",
      { section: "vertex-weight" },
    );
  }
}

export function skipPMXWeight(reader: PMXBinaryReader, boneIndexSize: number) {
  readPMXWeight(reader, boneIndexSize);
}

export class PMXBinaryReader {
  private view: DataView;
  private budget: ParseBudget;
  offset = 0;

  constructor(
    private bytes: Uint8Array,
    private filename = "PMX/PMD input",
    budgetOverrides: Partial<ParseBudget> = {},
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.budget = resolveParseBudget({
      maxInputBytes: 200 * 1024 * 1024,
      ...budgetOverrides,
    });
    if (bytes.byteLength > this.budget.maxInputBytes) {
      throw new ParseDomainError(
        "PARSE_BUDGET_EXCEEDED",
        "PMX/PMD input exceeds the processing limit",
        {
          filename,
          section: "binary",
          declared: bytes.byteLength,
          limit: this.budget.maxInputBytes,
        },
      );
    }
  }

  get remaining() {
    return this.bytes.byteLength - this.offset;
  }

  readAscii(length: number) {
    this.ensureRemaining(length, "ASCII string");
    const value = new TextDecoder().decode(
      this.bytes.slice(this.offset, this.offset + length),
    );
    this.offset += length;
    return value;
  }

  readText(encoding: PMXEncoding) {
    const length = this.readInt32();
    assertCountWithinBudget(length, this.budget.maxStringBytes, "PMX text bytes", {
      filename: this.filename,
      offset: this.offset - 4,
      section: "text",
    });
    this.ensureRemaining(length, "text");
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder(encoding).decode(value).replace(/\0+$/, "");
  }

  readShiftJISString(length: number) {
    this.ensureRemaining(length, "Shift-JIS string");
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    const end = value.indexOf(0);
    return new TextDecoder("shift-jis")
      .decode(end >= 0 ? value.slice(0, end) : value)
      .trim();
  }

  readVector2(): [number, number] {
    return [this.readFloat32(), this.readFloat32()];
  }

  readVector3(): [number, number, number] {
    return [this.readFloat32(), this.readFloat32(), this.readFloat32()];
  }

  readColor4(): [number, number, number, number] {
    return [
      this.readFloat32(),
      this.readFloat32(),
      this.readFloat32(),
      this.readFloat32(),
    ];
  }

  readIndex(size: number) {
    if (size === 1) return this.readInt8();
    if (size === 2) return this.readInt16();
    if (size === 4) return this.readInt32();
    throw new Error(`PMX signed index size must be 1, 2, or 4; found ${size}.`);
  }

  readUnsignedIndex(size: number) {
    if (size === 1) return this.readUint8();
    if (size === 2) return this.readUint16();
    if (size === 4) return this.readUint32();
    throw new Error(`PMX unsigned index size must be 1, 2, or 4; found ${size}.`);
  }

  readCount({ max, label }: { max: number; label: string }) {
    const offset = this.offset;
    const count = this.readInt32();
    return assertCountWithinBudget(count, max, label, {
      filename: this.filename,
      offset,
      section: "count",
    });
  }

  readUnsignedCount({
    max,
    label,
    size = 4,
  }: {
    max: number;
    label: string;
    size?: 2 | 4;
  }) {
    const offset = this.offset;
    const count = size === 2 ? this.readUint16() : this.readUint32();
    return assertCountWithinBudget(count, max, label, {
      filename: this.filename,
      offset,
      section: "count",
    });
  }

  readInt8() {
    this.ensureRemaining(1, "int8");
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUint8() {
    this.ensureRemaining(1, "uint8");
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readInt16() {
    this.ensureRemaining(2, "int16");
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readUint16() {
    this.ensureRemaining(2, "uint16");
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readInt32() {
    this.ensureRemaining(4, "int32");
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readUint32() {
    this.ensureRemaining(4, "uint32");
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readFloat32() {
    this.ensureRemaining(4, "float32");
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    if (!Number.isFinite(value)) {
      throw new ParseDomainError(
        "PARSE_INVALID_NUMBER",
        "PMX/PMD float is not finite",
        { filename: this.filename, offset: this.offset - 4, section: "binary" },
      );
    }
    return value;
  }

  skip(length: number) {
    this.ensureRemaining(length, "skip");
    this.offset += length;
  }

  private ensureRemaining(length: number, section: string) {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new ParseDomainError(
        "PARSE_INVALID_LENGTH",
        "PMX/PMD read length is invalid",
        {
          filename: this.filename,
          offset: this.offset,
          section,
          declared: length,
          limit: this.remaining,
        },
      );
    }
    if (length > this.remaining) {
      throw new ParseDomainError(
        "PARSE_TRUNCATED",
        "PMX/PMD input is truncated",
        {
          filename: this.filename,
          offset: this.offset,
          section,
          declared: length,
          limit: this.remaining,
        },
      );
    }
  }
}
