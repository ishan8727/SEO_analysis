// Just the parts of node-webpmux (no bundled types) that scripts/make-logo-animation.ts uses.
declare module "node-webpmux" {
  export interface Frame {
    readonly __frame: unique symbol;
  }
  export class Image {
    readonly width: number;
    readonly height: number;
    load(source: string | Buffer): Promise<void>;
    static generateFrame(opts: {
      buffer: Buffer;
      x?: number;
      y?: number;
      delay?: number;
      blend?: boolean;
      dispose?: boolean;
    }): Promise<Frame>;
    static save(
      path: string | null,
      opts: { width: number; height: number; frames: Frame[]; loops?: number; bgColor?: [number, number, number, number] },
    ): Promise<Buffer | undefined>;
  }
  const WebP: { Image: typeof Image };
  export default WebP;
}
