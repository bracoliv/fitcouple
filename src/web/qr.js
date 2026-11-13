import { renderSVG } from "uqr";

export function voucherQr(code) {
  return renderSVG(code, { ecc: "M", border: 2 });
}
