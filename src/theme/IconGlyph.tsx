import {
  iconCharacter,
  type IconDefinition,
  type PreparedIcons,
} from "./icon-theme";

export function IconGlyph({
  theme,
  definition,
  size = 16,
  product = false,
}: {
  theme: PreparedIcons;
  definition: IconDefinition;
  size?: number | string;
  product?: boolean;
}) {
  const font =
    theme.data.fonts?.find((font) => font.id === definition.fontId) ??
    theme.data.fonts?.[0];
  const rawSize = product
    ? "100%"
    : (definition.fontSize ?? font?.size ?? "150%");
  const percentage = /^\d+(\.\d+)?%$/.test(rawSize)
    ? parseFloat(rawSize)
    : /^\d+px$/.test(rawSize)
      ? (parseFloat(rawSize) / 13) * 100
      : 150;
  return (
    <text
      x="12"
      y="12"
      dominantBaseline="central"
      textAnchor="middle"
      stroke="none"
      fill={
        !product && /^#[\da-f]{3,8}$/i.test(definition.fontColor ?? "")
          ? definition.fontColor
          : "currentColor"
      }
      style={{
        fontFamily: font ? JSON.stringify(theme.fonts[font.id]) : undefined,
        fontSize: (24 * percentage) / 100,
        fontWeight: font?.weight ?? "normal",
        fontStyle: font?.style ?? "normal",
      }}
      data-glyph-size={size}
    >
      {iconCharacter(definition.fontCharacter ?? "")}
    </text>
  );
}
