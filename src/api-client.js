import http from 'node:http';

export function fetchApiProfile({ username, token, baseUrl }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}/api/v1/mail/auth`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ raw: data });
            }
          } else {
            reject(new Error(`API request failed with ${res.statusCode}: ${data}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(JSON.stringify({ username, password: token }));
    req.end();
  });
}
