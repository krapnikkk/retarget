export function validateFiniteTimeSeries({
  duration,
  label,
  maxSamples,
  times,
  valueSize,
  values,
}: {
  duration?: number;
  label: string;
  maxSamples: number;
  times: unknown;
  valueSize: number;
  values: unknown;
}) {
  const issues: string[] = [];
  if (!Array.isArray(times) || times.length === 0) {
    issues.push(`${label}.times must contain samples.`);
  }
  if (!Array.isArray(values) || values.length === 0) {
    issues.push(`${label}.values must contain samples.`);
  }
  if (!Array.isArray(times) || !Array.isArray(values)) {
    return { issues, sampleCount: 0 };
  }
  if (times.length > maxSamples) {
    issues.push(`${label} must not contain more than ${maxSamples} samples.`);
  }
  if (times.length * valueSize !== values.length) {
    issues.push(
      `${label}.values length must equal times length * ${valueSize}.`,
    );
  }

  let previous = -Infinity;
  times.forEach((time, sampleIndex) => {
    if (!Number.isFinite(time)) {
      issues.push(`${label}.times[${sampleIndex}] must be finite.`);
    } else {
      if (time < 0) {
        issues.push(`${label}.times[${sampleIndex}] must be non-negative.`);
      }
      if (time <= previous) {
        issues.push(`${label}.times must be strictly increasing.`);
      }
      if (duration !== undefined && time > duration + 1e-6) {
        issues.push(`${label}.times[${sampleIndex}] exceeds duration.`);
      }
      previous = time;
    }
  });
  values.forEach((value, valueIndex) => {
    if (!Number.isFinite(value)) {
      issues.push(`${label}.values[${valueIndex}] must be finite.`);
    }
  });

  return { issues, sampleCount: times.length };
}

export function validateQuaternionSamples({
  label,
  values,
}: {
  label: string;
  values: unknown;
}) {
  const issues: string[] = [];
  if (!Array.isArray(values) || values.length % 4 !== 0) {
    return issues;
  }
  for (let index = 0; index < values.length; index += 4) {
    const length = Math.hypot(
      values[index] ?? 0,
      values[index + 1] ?? 0,
      values[index + 2] ?? 0,
      values[index + 3] ?? 0,
    );
    if (!Number.isFinite(length) || length < 1e-6) {
      issues.push(
        `${label} contains a zero or invalid quaternion at sample ${index / 4}.`,
      );
    } else if (Math.abs(length - 1) > 0.05) {
      issues.push(
        `${label} contains a non-normalized quaternion at sample ${index / 4}.`,
      );
    }
  }
  return issues;
}
