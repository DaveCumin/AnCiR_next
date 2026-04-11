// @ts-nocheck
import { KahanSum, kahanMean } from './numerics.js';

export function calculateStandardDeviation(arr) {
  const validArr = arr.filter((v) => v !== undefined && !isNaN(v));
  if (validArr.length === 0) return NaN;

  const meanVal = kahanMean(validArr);

  const k = new KahanSum();
  for (const value of validArr) {
    k.add(Math.pow(value - meanVal, 2));
  }

  return Math.sqrt(k.value / validArr.length);
}

//make an array from start to end, in steps
export function createSequenceArray(start, end, step = 1) {
  const sequenceArray = [];
  for (let i = start; i <= end; i += step) {
    sequenceArray.push(i);
  }
  return sequenceArray;
}

export function mean(data) {
  return kahanMean(data);
}

export function max(data) {
  let maxVal = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < data.length; i++) {
    let val = safeParse(data[i]); // Ensure to handle falsy values correctly
    if (val > maxVal) {
      maxVal = val;
    }
  }
  return maxVal > Number.NEGATIVE_INFINITY ? maxVal : NaN;
}

export function min(data) {
  let minVal = Number.POSITIVE_INFINITY;
  for (let i = 0; i < data.length; i++) {
    let val = safeParse(data[i]); // Ensure to handle falsy values correctly
    if (val < minVal) {
      minVal = val;
    }
  }
  return minVal < Number.POSITIVE_INFINITY ? minVal : NaN;
}

//Safely parse a string into a number, with a fallback/default
function safeParse(data, DEFAULT = NaN) {
  const parsed = parseFloat(data);
  return parsed === undefined || Number.isNaN(parsed) ? DEFAULT : parsed;
}
