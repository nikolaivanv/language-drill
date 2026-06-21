import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components';

export interface ConfirmSubscriptionEmailProps {
  confirmUrl: string;
}

export function ConfirmSubscriptionEmail({
  confirmUrl,
}: ConfirmSubscriptionEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Confirm your weekly Language Drill summary</Preview>
      <Body style={{ backgroundColor: '#f6f6f6', fontFamily: 'sans-serif' }}>
        <Container style={{ padding: '24px', maxWidth: '480px' }}>
          <Heading as="h1" style={{ fontSize: '20px' }}>
            Confirm your weekly summary
          </Heading>
          <Text>
            You asked to receive a weekly progress summary from Language Drill.
            Confirm below to start receiving it. If this wasn&apos;t you, just
            ignore this email — nothing will be sent.
          </Text>
          <Button
            href={confirmUrl}
            style={{
              backgroundColor: '#111827',
              color: '#ffffff',
              padding: '12px 20px',
              borderRadius: '8px',
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Confirm subscription
          </Button>
          <Text style={{ fontSize: '12px', color: '#6b7280' }}>
            Or paste this link into your browser:{' '}
            <Link href={confirmUrl}>{confirmUrl}</Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default ConfirmSubscriptionEmail;
