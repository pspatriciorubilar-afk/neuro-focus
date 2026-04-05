/// <reference types="vite/client" />

declare module "*.png" {
  const pngValue: string;
  export default pngValue;
}

declare module "*.jpg" {
  const jpgValue: string;
  export default jpgValue;
}

declare module "*.svg" {
  const svgValue: string;
  export default svgValue;
}
