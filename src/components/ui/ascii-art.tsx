"use client";
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useId,
} from "react";
import { cn } from "@/lib/utils";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// True once the element is at least 10% in view. Replaces motion's useInView, so this component
// doesn't pull in the motion library.
function useInViewOnce(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean
): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || inView || !el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled, inView]);
  return inView;
}

const ASCII_CHARSETS = {
  standard: " .,:;i1tfLCG08@",
  blocks: " ░▒▓█",
  binary: " 01",
  dots: " ·•●",
  minimal: " .:░▒",
  dense: " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  arrows: " ←↑→↓↔↕↖↗↘↙",
  stars: " ·✦✧★",
  hash: " -=#",
  pipes: " |/─\\│",
  braille: " ⠁⠃⠇⠏⠟⠿⡿⣿",
  circles: " ○◔◑◕●",
  squares: " ▢▣▤▥▦▧▨▩",
  hearts: " ♡♥",
  math: " +-×÷=≠≈∞",
} as const;

type CharsetPreset = keyof typeof ASCII_CHARSETS;

const isCharsetPreset = (value: string): value is CharsetPreset => {
  return value in ASCII_CHARSETS;
};

const resolveCharset = (charset: string): string => {
  if (isCharsetPreset(charset)) {
    return ASCII_CHARSETS[charset];
  }
  return charset;
};

const resolveCssColor = (
  color: string,
  element: HTMLElement | null
): string => {
  if (!color) return color;

  if (color.startsWith("var(")) {
    if (!element) return "#ffffff";

    const tempDiv = document.createElement("div");
    tempDiv.style.color = color;
    element.appendChild(tempDiv);
    const computedColor = getComputedStyle(tempDiv).color;
    element.removeChild(tempDiv);
    return computedColor || "#ffffff";
  }

  return color;
};

type AsciiArtProps = {
  src: string;
  /** Number of ASCII columns (character resolution). Higher = more detail. */
  resolution?: number;
  /** Charset preset name ("standard", "blocks", "binary", etc.) or custom character string */
  charset?: CharsetPreset | string;
  /** Text color for the ASCII art (ignored if colored=true) */
  color?: string;
  /** Background color */
  backgroundColor?: string;
  /** Convert to inverted colors (dark bg, light text) */
  inverted?: boolean;
  /** Enable colored ASCII (uses image colors) */
  colored?: boolean;
  /** Enable animation on load */
  animated?: boolean;
  /** Animation style */
  animationStyle?: "fade" | "typewriter" | "matrix" | "none";
  /** Load animation length in seconds. Default: fade 1s, matrix 3s, typewriter 2ms per character */
  animationDuration?: number;
  /** Font family for ASCII characters */
  fontFamily?: string;
  /** Container className - use this to control size (e.g., w-full, h-64) */
  className?: string;
  /** Only animate when in view */
  animateOnView?: boolean;
  /** How the image should fit within the ASCII grid */
  objectFit?: "cover" | "contain" | "fill";
  /** Highest device pixel ratio to render at (default 2; lower is cheaper) */
  maxDpr?: number;
};
const MATRIX_CHARSET = "ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ";

type AsciiPixel = {
  char: string;
  r: number;
  g: number;
  b: number;
};

export const AsciiArt: React.FC<AsciiArtProps> = ({
  src,
  resolution = 80,
  charset = "standard",
  color = "#ffffff",
  backgroundColor = "transparent",
  inverted = false,
  colored = false,
  animated = true,
  animationStyle = "fade",
  animationDuration,
  fontFamily = "monospace",
  className,
  animateOnView = true,
  objectFit = "cover",
  maxDpr = 2,
}) => {
  const uniqueId = useId();
  const [asciiData, setAsciiData] = useState<AsciiPixel[][]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAnimated, setHasAnimated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const isInView = useInViewOnce(containerRef, animated && animateOnView && isLoaded);

  const shouldStartAnimation = animated && animateOnView ? isInView : animated;
  const shouldShowStatic = !animated || animationStyle === "none";

  const resolvedCharset = resolveCharset(charset);
  const effectiveCharset = inverted
    ? resolvedCharset.split("").reverse().join("")
    : resolvedCharset;

  const defaultColor = inverted ? "#ffffff" : "#000000";
  const textColor = color || defaultColor;

  useEffect(() => {
    let isCancelled = false;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;

    img.onload = () => {
      if (isCancelled) return;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError("Canvas context not available");
        return;
      }

      const imgWidth = img.naturalWidth;
      const imgHeight = img.naturalHeight;
      const imgAspect = imgWidth / imgHeight;
      const charAspectRatio = 0.55;

      const cols = resolution;
      const rows = Math.floor(cols * charAspectRatio);

      canvas.width = cols;
      canvas.height = rows;

      const visualAspect = 1.0;

      let sx = 0,
        sy = 0,
        sw = imgWidth,
        sh = imgHeight;

      if (objectFit === "cover") {
        if (imgAspect > visualAspect) {
          sw = imgHeight * visualAspect;
          sx = (imgWidth - sw) / 2;
        } else {
          sh = imgWidth / visualAspect;
          sy = (imgHeight - sh) / 2;
        }
      } else if (objectFit === "contain") {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, cols, rows);

        let dw, dh, dx, dy;
        if (imgAspect > visualAspect) {
          dw = cols;
          dh = cols / imgAspect * charAspectRatio;
          dx = 0;
          dy = (rows - dh) / 2;
        } else {
          dh = rows;
          dw = rows * imgAspect / charAspectRatio;
          dx = (cols - dw) / 2;
          dy = 0;
        }
        ctx.drawImage(img, dx, dy, dw, dh);
      }

      if (objectFit !== "contain") {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cols, rows);
      }

      let imageData: ImageData;
      try {
        imageData = ctx.getImageData(0, 0, cols, rows);
      } catch {
        setError("Unable to read image data (CORS issue)");
        return;
      }

      const data = imageData.data;
      const result: AsciiPixel[][] = [];

      for (let y = 0; y < rows; y++) {
        const row: AsciiPixel[] = [];
        for (let x = 0; x < cols; x++) {
          const idx = (y * cols + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];

          const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const adjustedBrightness = a === 0 ? 0 : brightness;

          const charIndex = Math.floor(
            adjustedBrightness * (effectiveCharset.length - 1)
          );
          const char = effectiveCharset[charIndex] || " ";

          row.push({ char, r, g, b });
        }
        result.push(row);
      }

      setAsciiData(result);
      setIsLoaded(true);
    };

    img.onerror = () => {
      if (isCancelled) return;
      setError("Failed to load image");
    };

    return () => {
      isCancelled = true;
    };
  }, [src, resolution, effectiveCharset, objectFit]);

  const drawCanvas = useCallback(
    (progress: number = 1, matrixProgress?: number) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container || asciiData.length === 0) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Capped (default 2): full-screen canvases at 3x use a lot of memory on phones.
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      if (containerWidth === 0 || containerHeight === 0) return;

      canvas.width = containerWidth * dpr;
      canvas.height = containerHeight * dpr;
      canvas.style.width = `${containerWidth}px`;
      canvas.style.height = `${containerHeight}px`;
      ctx.scale(dpr, dpr);

      const resolvedBgColor = resolveCssColor(backgroundColor, container);
      const resolvedTextColor = resolveCssColor(textColor, container);

      if (resolvedBgColor !== "transparent") {
        ctx.fillStyle = resolvedBgColor;
        ctx.fillRect(0, 0, containerWidth, containerHeight);
      } else {
        ctx.clearRect(0, 0, containerWidth, containerHeight);
      }

      const rows = asciiData.length;
      const cols = asciiData[0]?.length || 0;
      if (cols === 0) return;

      const charWidth = containerWidth / cols;
      const charHeight = containerHeight / rows;
      const fontSize = Math.min(charWidth * 1.8, charHeight * 1.2);

      ctx.font = `${fontSize}px ${fontFamily}`;
      ctx.textBaseline = "top";
      ctx.textAlign = "center";

      const totalChars = rows * cols;
      const revealedChars = Math.floor(progress * totalChars);

      let charIndex = 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const pixel = asciiData[y][x];
          const cx = x * charWidth + charWidth / 2;
          const cy = y * charHeight;

          if (animationStyle === "typewriter" && charIndex >= revealedChars) {
            charIndex++;
            continue;
          }

          let displayChar = pixel.char;
          let displayColor = colored
            ? `rgb(${pixel.r}, ${pixel.g}, ${pixel.b})`
            : resolvedTextColor;

          if (animationStyle === "matrix" && matrixProgress !== undefined) {
            // Normalised to the grid so the sweep reaches the last column before the end.
            const charProgress = (((x / cols) * 2 + y / rows) / 3) * 0.85;
            if (matrixProgress < charProgress) {
              charIndex++;
              continue;
            } else if (matrixProgress < charProgress + 0.15) {
              displayChar =
                MATRIX_CHARSET[
                  Math.floor(Math.random() * MATRIX_CHARSET.length)
                ];
              // The text color, not the stock matrix green (brand palette). No shadowBlur glow:
              // it is the most expensive canvas operation and this redraws every frame.
              displayColor = resolvedTextColor;
            }
          }

          ctx.fillStyle = displayColor;
          ctx.globalAlpha = animationStyle === "fade" ? progress : 1;
          ctx.fillText(displayChar, cx, cy);

          charIndex++;
        }
      }

      ctx.globalAlpha = 1;
    },
    [
      asciiData,
      backgroundColor,
      colored,
      textColor,
      fontFamily,
      animationStyle,
      maxDpr,
    ]
  );

  useEffect(() => {
    if (!isLoaded || asciiData.length === 0) return;

    const draw = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        requestAnimationFrame(draw);
        return;
      }

      if (shouldShowStatic || hasAnimated || !shouldStartAnimation) {
        drawCanvas(1);
        return;
      }

      const startTime = performance.now();
      const duration =
        animationDuration !== undefined
          ? animationDuration * 1000
          : animationStyle === "typewriter"
            ? asciiData.length * asciiData[0]?.length * 2
            : animationStyle === "matrix"
              ? 3000
              : 1000;

      let lastDraw = 0;
      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // 30fps is plenty for a reveal and halves the full-grid redraws.
        if (progress < 1 && currentTime - lastDraw < 1000 / 30) {
          animationRef.current = requestAnimationFrame(animate);
          return;
        }
        lastDraw = currentTime;

        if (animationStyle === "matrix") {
          drawCanvas(1, progress);
        } else {
          drawCanvas(progress);
        }

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          setHasAnimated(true);
        }
      };

      animationRef.current = requestAnimationFrame(animate);
    };

    const frameId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frameId);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [
    isLoaded,
    shouldStartAnimation,
    shouldShowStatic,
    hasAnimated,
    animationStyle,
    animationDuration,
    drawCanvas,
    asciiData,
  ]);

  useIsomorphicLayoutEffect(() => {
    if (!isLoaded || asciiData.length === 0) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    drawCanvas(1);
  }, [isLoaded, asciiData, drawCanvas]);

  useEffect(() => {
    if (!isLoaded || asciiData.length === 0) return;

    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      drawCanvas(1);
    });

    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [isLoaded, asciiData, drawCanvas]);

  if (error) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-red-500 text-sm font-mono",
          className
        )}
      >
        Error: {error}
      </div>
    );
  }

  // Empty while loading: no "Loading..." text (it's used as a page background).
  if (!isLoaded) {
    return <div className={className} style={{ backgroundColor }} />;
  }

  const canvasElement = (
    <canvas
      key={uniqueId}
      id={`ascii-canvas-${uniqueId}`}
      ref={canvasRef}
      className="block w-full h-full"
      aria-label="ASCII art rendering of image"
      role="img"
    />
  );

  // Fade-in wrapper as a CSS animation (tw-animate-css) instead of motion.
  if (animationStyle === "fade" && animated && !hasAnimated) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "overflow-hidden",
          shouldStartAnimation ? "animate-in fade-in-0" : "opacity-0",
          className
        )}
        style={{
          backgroundColor,
          animationDuration: `${(animationDuration ?? 1) * 0.3}s`,
        }}
      >
        {canvasElement}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("overflow-hidden", className)}
      style={{ backgroundColor }}
    >
      {canvasElement}
    </div>
  );
};

export const AsciiArtStatic: React.FC<
  Omit<AsciiArtProps, "animated" | "animationStyle">
> = (props) => {
  return <AsciiArt {...props} animated={false} animationStyle="none" />;
};
