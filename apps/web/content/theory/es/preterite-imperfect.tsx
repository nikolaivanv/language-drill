import type { TheoryTopic } from '../../../components/theory/types';
import {
  Callout,
  Example,
  Hilite,
  Mono,
  ConjugationTable,
  TheoryList,
} from '../../../components/theory/primitives';

const preteriteImperfect: TheoryTopic = {
  id: 'preterite-imperfect',
  title: 'pretérito vs. imperfecto',
  subtitle: 'two past tenses, two different lenses on the same event',
  cefr: 'A2–B1',
  sections: [
    {
      id: 'what',
      title: "what's the difference?",
      body: (
        <>
          <p>
            both are past tenses. the difference is <strong>aspect</strong> —
            how you frame the action:
          </p>
          <TheoryList>
            <li>
              <strong>pretérito</strong> → completed, bounded events.
              snapshots.
            </li>
            <li>
              <strong>imperfecto</strong> → ongoing, habitual, descriptive.
              background.
            </li>
          </TheoryList>
          <Callout>
            think <strong>video clip</strong> (preterite) vs{' '}
            <strong>scenery</strong> (imperfect).
          </Callout>
        </>
      ),
    },
    {
      id: 'signals',
      title: 'signal words',
      body: (
        <>
          <p>
            certain time expressions almost always co-occur with one tense or
            the other. when you spot a signal, the choice is usually made for
            you.
          </p>
          <ConjugationTable>
            <thead>
              <tr>
                <th>pretérito (completed)</th>
                <th>imperfecto (ongoing / habitual)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Mono>ayer</Mono>
                </td>
                <td>
                  <Mono>siempre</Mono>
                </td>
              </tr>
              <tr>
                <td>
                  <Mono>anoche</Mono>
                </td>
                <td>
                  <Mono>todos los días</Mono>
                </td>
              </tr>
              <tr>
                <td>
                  <Mono>de repente</Mono>
                </td>
                <td>
                  <Mono>generalmente</Mono>
                </td>
              </tr>
              <tr>
                <td>
                  <Mono>una vez</Mono>
                </td>
                <td>
                  <Mono>cada semana</Mono>
                </td>
              </tr>
              <tr>
                <td>
                  <Mono>el lunes / en 2010</Mono>
                </td>
                <td>
                  <Mono>mientras</Mono>
                </td>
              </tr>
              <tr>
                <td>
                  <Mono>finalmente</Mono>
                </td>
                <td>
                  <Mono>cuando era niño/a</Mono>
                </td>
              </tr>
            </tbody>
          </ConjugationTable>
          <Callout variant="warn">
            <strong>two clauses, two tenses.</strong>{' '}
            <Mono>mientras</Mono> + imperfect (background) often pairs with a
            preterite (the interrupting event):{' '}
            <Mono>mientras leía, sonó el teléfono</Mono>.
          </Callout>
        </>
      ),
    },
    {
      id: 'formation',
      title: 'how they form',
      body: (
        <>
          <p>
            <strong>pretérito · regular endings</strong> — drop the infinitive
            ending and add:
          </p>
          <ConjugationTable>
            <thead>
              <tr>
                <th />
                <th>-AR (hablar)</th>
                <th>-ER (comer)</th>
                <th>-IR (vivir)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>yo</td>
                <td>hablé</td>
                <td>comí</td>
                <td>viví</td>
              </tr>
              <tr>
                <td>tú</td>
                <td>hablaste</td>
                <td>comiste</td>
                <td>viviste</td>
              </tr>
              <tr>
                <td>él/ella</td>
                <td>habló</td>
                <td>comió</td>
                <td>vivió</td>
              </tr>
              <tr>
                <td>nosotros</td>
                <td>hablamos</td>
                <td>comimos</td>
                <td>vivimos</td>
              </tr>
              <tr>
                <td>ellos</td>
                <td>hablaron</td>
                <td>comieron</td>
                <td>vivieron</td>
              </tr>
            </tbody>
          </ConjugationTable>
          <p>
            <strong>imperfecto · regular endings</strong> — much simpler, only
            two patterns:
          </p>
          <ConjugationTable>
            <thead>
              <tr>
                <th />
                <th>-AR (hablar)</th>
                <th>-ER / -IR (comer / vivir)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>yo</td>
                <td>hablaba</td>
                <td>comía / vivía</td>
              </tr>
              <tr>
                <td>tú</td>
                <td>hablabas</td>
                <td>comías / vivías</td>
              </tr>
              <tr>
                <td>él/ella</td>
                <td>hablaba</td>
                <td>comía / vivía</td>
              </tr>
              <tr>
                <td>nosotros</td>
                <td>hablábamos</td>
                <td>comíamos / vivíamos</td>
              </tr>
              <tr>
                <td>ellos</td>
                <td>hablaban</td>
                <td>comían / vivían</td>
              </tr>
            </tbody>
          </ConjugationTable>
          <Callout>
            <strong>imperfect has only three irregulars:</strong>{' '}
            <Mono>ser</Mono> (era, eras, era, éramos, eran),{' '}
            <Mono>ir</Mono> (iba, ibas, iba, íbamos, iban),{' '}
            <Mono>ver</Mono> (veía, veías, veía, veíamos, veían).
          </Callout>
        </>
      ),
    },
    {
      id: 'examples',
      title: 'examples',
      body: (
        <>
          <Example>
            <Example.ES>
              <Hilite>Caminaba</Hilite> por la calle cuando{' '}
              <Hilite>vi</Hilite> a Marta.
            </Example.ES>
            <Example.EN>
              I was walking down the street when I saw Marta.
            </Example.EN>
            <Example.Note>
              imperfect = ongoing scene; preterite = the bounded event that
              interrupts it.
            </Example.Note>
          </Example>
          <Example>
            <Example.ES>
              De niña <Hilite>vivía</Hilite> en Madrid.
            </Example.ES>
            <Example.EN>As a girl, I used to live in Madrid.</Example.EN>
            <Example.Note>
              imperfect = habitual past — repeated, no clear endpoint.
            </Example.Note>
          </Example>
          <Example>
            <Example.ES>
              Ayer <Hilite>hablé</Hilite> con mi hermano dos veces.
            </Example.ES>
            <Example.EN>Yesterday I spoke with my brother twice.</Example.EN>
            <Example.Note>
              preterite = bounded, completed actions on a specific day.
            </Example.Note>
          </Example>
          <Example>
            <Example.ES>
              <Hilite>Era</Hilite> de noche y <Hilite>llovía</Hilite>; de
              repente, alguien <Hilite>llamó</Hilite> a la puerta.
            </Example.ES>
            <Example.EN>
              It was night and it was raining; suddenly, someone knocked at the
              door.
            </Example.EN>
            <Example.Note>
              imperfects set the scene; the preterite punches the action
              through it.
            </Example.Note>
          </Example>
        </>
      ),
    },
  ],
};

export default preteriteImperfect;
