import { config } from '../config.js';
import { fetchApiProfile } from '../api-client.js';

export async function authenticateSession(session) {
  const username = session?.user || '';
  const password = session?.password || '';

  if (!username || !password) {
    return null;
  }

  try {
    const profile = await fetchApiProfile({
      username,
      token: password,
      baseUrl: config.apiBaseUrl
    });

    return profile?.user ? { username, profile } : null;
  } catch (error) {
    console.error('[smtp] api auth failed', error.message);
    return null;
  }
}
