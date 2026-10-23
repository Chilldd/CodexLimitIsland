import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlassContainer } from "../src/components/GlassContainer";

describe("GlassContainer", () => {
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(performance.now());
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders with default glass classes and children", () => {
    const { container } = render(
      <GlassContainer className="custom-box" data-testid="glass">
        <span>烟晶内容</span>
      </GlassContainer>,
    );

    const el = container.firstElementChild as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.classList.contains("glass-container")).toBe(true);
    expect(el.classList.contains("glass-card")).toBe(true);
    expect(el.classList.contains("custom-box")).toBe(true);
    expect(screen.getByText("烟晶内容")).toBeTruthy();
  });

  it("supports standalone elevation", () => {
    const { container } = render(
      <GlassContainer elevation="standalone">
        <span>主窗口容器</span>
      </GlassContainer>,
    );

    const el = container.firstElementChild as HTMLElement;
    expect(el.classList.contains("glass-standalone")).toBe(true);
    expect(el.classList.contains("glass-card")).toBe(false);
  });

  it("supports polymorphic element types and passes html attributes", () => {
    const handleClick = vi.fn();
    render(
      <GlassContainer as="button" type="button" onClick={handleClick}>
        点击按钮
      </GlassContainer>,
    );

    const button = screen.getByRole("button", { name: "点击按钮" });
    expect(button.tagName.toLowerCase()).toBe("button");
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("adjusts light angle and shift on pointermove and resets on pointerleave", () => {
    const { container } = render(
      <GlassContainer elevation="card">
        <div>微光测试</div>
      </GlassContainer>,
    );

    const el = container.firstElementChild as HTMLElement;
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 100,
      width: 200,
      height: 100,
      right: 300,
      bottom: 200,
      x: 100,
      y: 100,
      toJSON: () => {},
    });

    // 模拟鼠标移动到偏右下方 (x: 250, y: 180)
    // 相对偏移：x = (250-100)/200 - 0.5 = 0.25; y = (180-100)/100 - 0.5 = 0.3
    // baseAngle = 118, angleShift = 5 -> 118 + 0.3 * 5 = 119.5deg
    // positionShift = 7 -> 0.25 * 7 = 1.75%
    fireEvent.pointerMove(el, {
      clientX: 250,
      clientY: 180,
      pointerType: "mouse",
    });

    expect(el.style.getPropertyValue("--glass-light-angle")).toBe("119.5deg");
    expect(el.style.getPropertyValue("--glass-light-shift")).toBe("1.75%");

    // 移出后复位
    fireEvent.pointerLeave(el);
    expect(el.style.getPropertyValue("--glass-light-angle")).toBe("");
    expect(el.style.getPropertyValue("--glass-light-shift")).toBe("");
  });

  it("respects interactive={false} to disable pointer dynamics", () => {
    const { container } = render(
      <GlassContainer interactive={false}>
        <div>静止玻璃</div>
      </GlassContainer>,
    );

    const el = container.firstElementChild as HTMLElement;
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.pointerMove(el, {
      clientX: 50,
      clientY: 50,
      pointerType: "mouse",
    });

    expect(el.style.getPropertyValue("--glass-light-angle")).toBe("");
  });

  it("skips light adjustment when prefers-reduced-motion is active", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { container } = render(
      <GlassContainer>
        <div>减弱动效</div>
      </GlassContainer>,
    );

    const el = container.firstElementChild as HTMLElement;
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.pointerMove(el, {
      clientX: 90,
      clientY: 90,
      pointerType: "mouse",
    });

    expect(el.style.getPropertyValue("--glass-light-angle")).toBe("");
  });
});
