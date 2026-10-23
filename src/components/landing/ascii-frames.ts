// Source frames of the landing page ASCII background (`pnpm ascii:frames`). Its own module so the
// loader can preload them without pulling in the background component.
export const ASCII_FRAMES = [1, 2, 3, 4].map((n) => `/ascii/bg-frame-${n}.svg`);
