/** Session restoration is not an instruction to start creating a character.
 * Validate the session with an authenticated API read before leaving the landing page.
 */
export async function restoredLandingRoute(
  authenticate: () => Promise<string>,
  loadCharacters: () => Promise<unknown[]>,
): Promise<'/home' | null> {
  try {
    await authenticate();
    await loadCharacters();
    return '/home';
  } catch {
    return null;
  }
}
