export async function getSodium() {
  // Browser-only dynamic import
  const sodium = await import("libsodium-wrappers");
  await sodium.default.ready;
  return sodium.default;
}