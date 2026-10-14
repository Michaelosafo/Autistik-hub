/** The exact text members sign in their wallet. Proves they own the address; costs no gas. */
export function linkMessage(uid: string, issued: string) {
  return `AUTISTIK Hub wallet link\nUser: ${uid}\nIssued: ${issued}\n\nSigning this is free and does not move any funds.`;
}
