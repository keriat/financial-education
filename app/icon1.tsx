import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// 512×512 maskable: содержимое держим в безопасной зоне (~80%),
// чтобы Android не обрезал букву под свою маску.
export default function Icon512() {
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
          fontSize: 280,
          fontWeight: 900,
          letterSpacing: -10,
        }}
      >
        К
      </div>
    ),
    { ...size }
  );
}
