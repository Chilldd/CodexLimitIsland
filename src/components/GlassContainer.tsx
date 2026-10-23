import {
  forwardRef,
  useImperativeHandle,
  type ComponentPropsWithRef,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from "react";
import { useGlassLight, type GlassLightOptions } from "../hooks/useGlassLight";

type GlassContainerOwnProps<E extends ElementType = "div"> = {
  /** 语义化渲染标签，默认为 "div" */
  as?: E;
  /** 自定义类名 */
  className?: string;
  /** 是否开启光束随指针跟随的微动效，默认为 true */
  interactive?: boolean;
  /** 投影与材质层级：standalone 为悬浮主容器，card 为内部卡片 */
  elevation?: "standalone" | "card";
  /** 光照定制参数 */
  lightOptions?: Omit<GlassLightOptions, "disabled">;
  /** 子元素 */
  children?: ReactNode;
};

export type GlassContainerProps<E extends ElementType = "div"> = GlassContainerOwnProps<E> &
  Omit<ComponentPropsWithRef<E>, keyof GlassContainerOwnProps<E>>;

function GlassContainerInner<E extends ElementType = "div">(
  {
    as,
    className = "",
    interactive = true,
    elevation = "card",
    lightOptions,
    children,
    onPointerMove,
    onPointerLeave,
    ...rest
  }: GlassContainerProps<E>,
  forwardedRef: React.ForwardedRef<Element>,
): ReactElement {
  const Component = (as || "div") as ElementType;
  const {
    ref: internalRef,
    onPointerMove: handleGlassMove,
    onPointerLeave: handleGlassLeave,
  } = useGlassLight<HTMLElement>({
    ...lightOptions,
    disabled: !interactive,
  });

  useImperativeHandle(forwardedRef, () => internalRef.current as Element);

  const elevationClass = elevation === "standalone" ? "glass-standalone" : "glass-card";
  const composedClassName = `glass-container ${elevationClass} ${className}`.trim();

  return (
    <Component
      ref={internalRef}
      className={composedClassName}
      onPointerMove={(e: React.PointerEvent<HTMLElement>) => {
        handleGlassMove(e);
        if (typeof onPointerMove === "function") {
          (onPointerMove as (e: React.PointerEvent<HTMLElement>) => void)(e);
        }
      }}
      onPointerLeave={(e: React.PointerEvent<HTMLElement>) => {
        handleGlassLeave();
        if (typeof onPointerLeave === "function") {
          (onPointerLeave as (e: React.PointerEvent<HTMLElement>) => void)(e);
        }
      }}
      {...rest}
    >
      {children}
    </Component>
  );
}

/**
 * 封装“斜光烟晶 · V5”质感的玻璃容器组件。
 * 具备中性半透明折射背景、窄切面折射光边缘蒙版、斜向柔光反射与指针跟随微交互。
 */
export const GlassContainer = forwardRef(GlassContainerInner) as <E extends ElementType = "div">(
  props: GlassContainerProps<E> & { ref?: React.ForwardedRef<Element> },
) => ReactElement;
