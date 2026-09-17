/**
 * Pure functions from data to a message. No I/O, no configuration, no
 * dependency on how delivery happens — so what a mail says can be changed and
 * read without touching the transport, and the transport without touching the
 * words.
 *
 * Deliberately no template library. mjml, handlebars and react-email all earn
 * their place at some number of templates; that number is not two.
 */

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const BRAND = 'PokeDrop';

/**
 * Styles are inline rather than in a <style> block: a good share of mail
 * clients strip the head, and a stripped stylesheet leaves an unreadable page
 * rather than a plain one.
 */
function layout(heading: string, paragraph: string, cta: string, url: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a1a1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <p style="margin:0 0 24px;font-size:18px;font-weight:600;">${BRAND}</p>
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${heading}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#444;">${paragraph}</p>
      <p style="margin:0 0 24px;">
        <a href="${url}" style="display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;">${cta}</a>
      </p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#777;">
        If the button does not work, paste this into your browser:<br />
        <span style="word-break:break-all;">${url}</span>
      </p>
    </div>
  </body>
</html>`;
}

/**
 * Every template carries a text part as well as HTML. It is not decoration:
 * its absence is one of the signals spam filters weigh, and it is what a
 * plain-text client shows.
 */
function plain(heading: string, paragraph: string, url: string): string {
  return `${BRAND}

${heading}

${paragraph}

${url}
`;
}

export function verificationEmail(input: { displayName: string; url: string }): RenderedMail {
  const heading = `Confirm your email, ${input.displayName}`;
  const paragraph =
    'Confirming the address finishes setting up your account. The link is good for one hour.';

  return {
    subject: `Confirm your ${BRAND} email`,
    html: layout(heading, paragraph, 'Confirm email', input.url),
    text: plain(heading, paragraph, input.url),
  };
}

export function passwordResetEmail(input: { displayName: string; url: string }): RenderedMail {
  const heading = `Reset your password, ${input.displayName}`;
  const paragraph =
    'Use the link below to choose a new password. It works once and expires in an hour. ' +
    'If you did not ask for this, nothing has changed and you can ignore this message.';

  return {
    subject: `Reset your ${BRAND} password`,
    html: layout(heading, paragraph, 'Reset password', input.url),
    text: plain(heading, paragraph, input.url),
  };
}
