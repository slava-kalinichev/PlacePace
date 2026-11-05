// Логотип экрана входа (я использовал ИИ для создания этой анимации)
import { useEffect, useMemo, useRef } from 'react';

const RING_SIZE = 196;

const ANCHOR_COLORS: [number, number, number][] = [
  [0, 122, 255],   // синий
  [255, 255, 255], // белый
  [156, 163, 175], // серый
  [17, 24, 39],    // чёрный
];

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

// Цвет точки по углу
function colorForAngle(angle: number): string {
  const segment = ANCHOR_COLORS.length;
  const pos = (angle / (Math.PI * 2)) * segment;
  const from = ((Math.floor(pos) % segment) + segment) % segment;
  const to = (from + 1) % segment;
  const t = pos - Math.floor(pos);
  return lerpColor(ANCHOR_COLORS[from], ANCHOR_COLORS[to], t);
}

// Радиусы колец; размер точки растёт с радиусом
const BANDS = [
  { radius: 55, baseSize: 4, count: 14, spinDuration: 26, spinDirection: 1, entranceDelay: 0 },
  { radius: 66, baseSize: 5.2, count: 18, spinDuration: 34, spinDirection: -1, entranceDelay: 140 },
  { radius: 77, baseSize: 6.4, count: 22, spinDuration: 20, spinDirection: 1, entranceDelay: 280 },
  { radius: 88, baseSize: 7.6, count: 26, spinDuration: 30, spinDirection: -1, entranceDelay: 420 },
];

function sizeFactorForAngle(angle: number): number {
  // Волна размера точек (3 "горба" за оборот)
  return 1 + 0.18 * Math.sin(angle * 3);
}

const AnimatedAccountLogo = () => {
  const bands = useMemo(() => {
    return BANDS.map((band) => ({
      ...band,
      dots: Array.from({ length: band.count }, (_, i) => ({
        baseAngle: (i / band.count) * Math.PI * 2,
        popDelay: i * 14,
      })),
    }));
  }, []);

  const bandRotateRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dotRefs = useRef<(HTMLDivElement | null)[][]>(bands.map((band) => Array(band.dots.length).fill(null)));

  useEffect(() => {
    const startTime = performance.now();
    let rafId: number;

    const tick = (now: number) => {
      const elapsed = now - startTime;

      bands.forEach((band, bandIndex) => {
        const revolutions = elapsed / (band.spinDuration * 1000);
        const angleOffset = band.spinDirection * revolutions * Math.PI * 2;

        const wrapper = bandRotateRefs.current[bandIndex];
        if (wrapper) {
          wrapper.style.transform = `rotate(${(angleOffset * 180) / Math.PI}deg)`;
        }

        band.dots.forEach((dot, dotIndex) => {
          const raw = dot.baseAngle + angleOffset;
          const normalized = ((raw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          const el = dotRefs.current[bandIndex]?.[dotIndex];
          if (el) {
            el.style.backgroundColor = colorForAngle(normalized);
            el.style.transform = `scale(${sizeFactorForAngle(normalized)})`;
          }
        });
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="relative flex items-center justify-center flex-shrink-0 mx-auto"
      style={{ width: RING_SIZE, height: RING_SIZE }}
    >
      {bands.map((band, bandIndex) => (
        // Уровень 1: вращение кольца (из JS, каждый кадр)
        <div
          key={bandIndex}
          ref={(el) => { bandRotateRefs.current[bandIndex] = el; }}
          className="absolute inset-0"
        >
          {/* Уровень 2: закручивание кольца при появлении */}
          <div
            className="absolute inset-0 pp-account-logo-band-in"
            style={{ animationDelay: `${band.entranceDelay}ms` }}
          >
            {band.dots.map((dot, dotIndex) => {
              const x = Math.cos(dot.baseAngle) * band.radius;
              const y = Math.sin(dot.baseAngle) * band.radius;
              return (
                // Уровень 3: позиция и появление точки
                <div
                  key={dotIndex}
                  className="absolute pp-account-logo-dot"
                  style={{
                    width: band.baseSize,
                    height: band.baseSize,
                    left: `calc(50% + ${x}px)`,
                    top: `calc(50% + ${y}px)`,
                    marginLeft: -band.baseSize / 2,
                    marginTop: -band.baseSize / 2,
                    animationDelay: `${band.entranceDelay + dot.popDelay}ms`,
                  }}
                >
                  {/* Уровень 4: цвет и размер точки пишет tick() напрямую в DOM */}
                  <div
                    ref={(el) => { dotRefs.current[bandIndex][dotIndex] = el; }}
                    className="w-full h-full rounded-full"
                    style={{
                      backgroundColor: colorForAngle(dot.baseAngle),
                      boxShadow: '0 0 0 1px rgba(15, 23, 42, 0.06)',
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Сам логотип поверх колец, без вращения */}
      <img
        src="/images/pp_logo.png"
        alt="Place Pace"
        className="relative z-10 animate-[logoFadeIn_0.6s_ease-out_both]"
        style={{ height: '5.5rem', animationDelay: '150ms' }}
      />
    </div>
  );
};

export default AnimatedAccountLogo;
