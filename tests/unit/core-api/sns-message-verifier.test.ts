import { isSnsUrl, SnsMessageVerifier } from '../../../packages/core-api/src/modules/email';
import { snsSigner } from '../../support/sns-messages';

describe('SNS message verifier', () => {
  it('accepts a notification and a subscription confirmation signed with the certificate at an SNS URL, under SHA256 and SHA1', async () => {
    const signer = snsSigner();
    const verifier = new SnsMessageVerifier({ fetchCertificate: signer.fetchCertificate });

    const results = await Promise.all([
      verifier.verify(signer.sign({ Type: 'Notification', Message: '{"eventType":"Delivery"}' })),
      verifier.verify(signer.sign({ Type: 'Notification', Subject: 'Amazon SES Email Event Notification', SignatureVersion: '1' })),
      verifier.verify(signer.sign({
        Type: 'SubscriptionConfirmation',
        SubscribeURL: 'https://sns.us-east-2.amazonaws.com/?Action=ConfirmSubscription&Token=abc',
        Token: 'abc',
      })),
    ]);

    expect(results).toEqual([true, true, true]);
  });

  it('refuses a message whose signed fields were changed after signing', async () => {
    const signer = snsSigner();
    const verifier = new SnsMessageVerifier({ fetchCertificate: signer.fetchCertificate });
    const message = signer.sign({ Type: 'Notification', Message: '{"eventType":"Delivery"}' });

    const results = await Promise.all([
      verifier.verify({ ...message, Message: '{"eventType":"Complaint"}' }),
      verifier.verify({ ...message, TopicArn: 'arn:aws:sns:us-east-2:999999999999:someone-else' }),
      verifier.verify({ ...message, Subject: 'added later' }),
    ]);

    expect(results).toEqual([false, false, false]);
  });

  it('refuses a message signed by a key other than the certificate\'s', async () => {
    const verifier = new SnsMessageVerifier({ fetchCertificate: snsSigner().fetchCertificate });

    expect(await verifier.verify(snsSigner().sign({ Type: 'Notification' }))).toBe(false);
  });

  it('refuses a certificate URL that is not https on an SNS host, without fetching it', async () => {
    const signer = snsSigner();
    const fetchCertificate = jest.fn(signer.fetchCertificate);
    const verifier = new SnsMessageVerifier({ fetchCertificate });

    const results = await Promise.all([
      'https://evil.example.com/cert.pem',
      'http://sns.us-east-2.amazonaws.com/cert.pem',
      'https://sns.us-east-2.amazonaws.com.evil.example.com/cert.pem',
      'https://sns.us-east-2.amazonaws.com:8443/cert.pem',
      'https://sns.us-east-2.amazonaws.com/cert.txt',
      'not a url',
    ].map((SigningCertURL) => verifier.verify(signer.sign({ Type: 'Notification', SigningCertURL }))));

    expect(results).toEqual(Array(6).fill(false));
    expect(fetchCertificate).not.toHaveBeenCalled();
  });

  it('fetches each certificate once, and again after a failed fetch', async () => {
    const signer = snsSigner();
    const fetchCertificate = jest.fn<Promise<string>, [string]>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(signer.certificate);
    const verifier = new SnsMessageVerifier({ fetchCertificate });

    const first = await verifier.verify(signer.sign({ Type: 'Notification' }));
    const second = await verifier.verify(signer.sign({ Type: 'Notification' }));
    const third = await verifier.verify(signer.sign({ Type: 'Notification' }));

    expect([first, second, third]).toEqual([false, true, true]);
    expect(fetchCertificate).toHaveBeenCalledTimes(2);
  });

  it('treats only https URLs on sns.<region>.amazonaws.com as SNS URLs', () => {
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription')).toBe(true);
    expect(isSnsUrl('https://sqs.eu-west-1.amazonaws.com/')).toBe(false);
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com/cert.pem', '.pem')).toBe(true);
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com/cert', '.pem')).toBe(false);
  });
});
