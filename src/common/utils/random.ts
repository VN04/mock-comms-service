/** Uniform random integer in [min, max] (inclusive). */
export const randomInt = (min: number, max: number): number =>
  Math.floor(min + Math.random() * (Math.max(max, min) - min + 1));
