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

export function storeReceivedEmail({ baseUrl, to, from, subject, body, recipientUsername }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}/api/v1/mail/receive`,
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
    req.write(JSON.stringify({ to, from, subject, body, recipientUsername }));
    req.end();
  });
}

export function sendEmailViaApi({ baseUrl, token, to, subject, body, cc, bcc, priority, attachments }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}/api/v1/mail/send`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
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
    req.write(JSON.stringify({ to, subject, body, cc, bcc, priority, attachments }));
    req.end();
  });
}
