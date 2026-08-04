import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

/**
 * The "T4" brand mark, matching the desktop sidebar wordmark SVG.
 * (apps/web Sidebar.tsx). Width derives from the viewBox aspect ratio.
 */
export function T3Wordmark(props: { readonly height: number; readonly color: ColorValue }) {
  const aspectRatio = 94.3941 / 56.96;
  return (
    <Svg
      accessibilityLabel="T4"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="15.5309 37 94.3941 56.96"
    >
      <Path
        d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM65 72L87.5 37H101L78.5 72H65ZM65 72H109V82H65V72ZM89 37H101V93H89V37Z"
        fill={props.color}
      />
    </Svg>
  );
}
