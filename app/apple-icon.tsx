import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS сам обрезает в скруглённый квадрат — оставляем плотный фон без прозрачности.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#1f6e5a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fbf1d8",
          fontSize: 110,
          fontWeight: 900,
          letterSpacing: -4,
        }}
      >
        К
      </div>
    ),
    { ...size }
  );
}
