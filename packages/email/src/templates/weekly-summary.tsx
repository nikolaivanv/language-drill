import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export interface WeeklySummaryEmailProps {
  exercisesCompleted: number;
  languagesPracticed: string[];
  daysActive: number;
  /** Grammar points that went well this week. */
  movers: string[];
  /** Weak spots to focus on next week. */
  focus: string[];
  practiceUrl: string;
  unsubscribeUrl: string;
}

export function WeeklySummaryEmail({
  exercisesCompleted,
  languagesPracticed,
  daysActive,
  movers,
  focus,
  practiceUrl,
  unsubscribeUrl,
}: WeeklySummaryEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your week in Language Drill</Preview>
      <Body style={{ backgroundColor: '#f6f6f6', fontFamily: 'sans-serif' }}>
        <Container style={{ padding: '24px', maxWidth: '480px' }}>
          <Heading as="h1" style={{ fontSize: '20px' }}>
            Your week in Language Drill
          </Heading>

          <Section>
            <Text style={{ margin: '4px 0' }}>
              <strong>{exercisesCompleted}</strong> exercises completed
            </Text>
            <Text style={{ margin: '4px 0' }}>
              Active on <strong>{daysActive}</strong>{' '}
              {daysActive === 1 ? 'day' : 'days'}
            </Text>
            <Text style={{ margin: '4px 0' }}>
              Practiced: {languagesPracticed.join(', ')}
            </Text>
          </Section>

          {movers.length > 0 && (
            <Section>
              <Hr />
              <Heading as="h2" style={{ fontSize: '16px' }}>
                Going well
              </Heading>
              {movers.map((m) => (
                <Text key={m} style={{ margin: '2px 0' }}>
                  • {m}
                </Text>
              ))}
            </Section>
          )}

          {focus.length > 0 && (
            <Section>
              <Hr />
              <Heading as="h2" style={{ fontSize: '16px' }}>
                Worth a look next week
              </Heading>
              {focus.map((f) => (
                <Text key={f} style={{ margin: '2px 0' }}>
                  • {f}
                </Text>
              ))}
            </Section>
          )}

          <Section style={{ marginTop: '20px' }}>
            <Button
              href={practiceUrl}
              style={{
                backgroundColor: '#111827',
                color: '#ffffff',
                padding: '12px 20px',
                borderRadius: '8px',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Practice now
            </Button>
          </Section>

          <Hr />
          <Text style={{ fontSize: '12px', color: '#6b7280' }}>
            You&apos;re receiving this because you confirmed the weekly summary.{' '}
            <Link href={unsubscribeUrl}>Unsubscribe</Link>.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default WeeklySummaryEmail;
