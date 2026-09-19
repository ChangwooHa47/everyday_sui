export function priceToMist(value: string) {
  if (!/^(0|[1-9]\d{0,10})(\.\d{1,9})?$/.test(value)) throw Error('가격을 확인해주세요.');
  const [whole, fraction = ''] = value.split('.');
  const mist = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
  if (mist <= 0n || mist > 18_446_744_073_709_551_615n) throw Error('가격을 확인해주세요.');
  return mist.toString();
}
