import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 120,
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
