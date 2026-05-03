import type { TheoryTopic } from '../../../components/theory/types';
import {
  Callout,
  Example,
  Hilite,
  Mono,
  ConjugationTable,
  TheoryList,
} from '../../../components/theory/primitives';

const subjunctive: TheoryTopic = {
  id: 'subjunctive',
  title: 'el subjuntivo',
  subtitle: 'present subjunctive · doubt, hope, desire, hypotheticals',
  cefr: 'B1–B2',
  sections: [
    {
      id: 'what',
      title: 'what is it?',
      body: (
        <>
          <p>
            the <Hilite>subjunctive</Hilite> is a <strong>mood</strong>, not a
            tense. it expresses how the speaker feels about an action — doubt,
            desire, emotion, possibility — rather than stating it as fact.
          </p>
          <p>
            english has it (rare):{' '}
            <em>
              &ldquo;i suggest he <strong>be</strong> here&rdquo;
            </em>
            ,{' '}
            <em>
              &ldquo;if i <strong>were</strong> you&rdquo;
            </em>
            . spanish uses it constantly.
          </p>
          <Callout>
            <strong>indicative</strong> = facts. <strong>subjunctive</strong> =
            subjective takes (doubt, hope, want, react).
          </Callout>
        </>
      ),
    },
    {
      id: 'when',
      title: 'when to use it',
      body: (
        <>
          <p>
            after a small set of <em>trigger expressions</em> in a main clause,
            followed by <Mono>que</Mono> + a different subject:
          </p>
          <TheoryList>
            <li>
              <strong>doubt:</strong> <Mono>no creo que…</Mono>,{' '}
              <Mono>dudo que…</Mono>
            </li>
            <li>
              <strong>hope / wish:</strong> <Mono>espero que…</Mono>,{' '}
              <Mono>ojalá…</Mono>
            </li>
            <li>
              <strong>desire / request:</strong> <Mono>quiero que…</Mono>,{' '}
              <Mono>te pido que…</Mono>
            </li>
            <li>
              <strong>emotion:</strong> <Mono>me alegro de que…</Mono>,{' '}
              <Mono>es triste que…</Mono>
            </li>
            <li>
              <strong>impersonal:</strong> <Mono>es importante que…</Mono>,{' '}
              <Mono>es posible que…</Mono>
            </li>
            <li>
              <strong>concession:</strong> <Mono>aunque…</Mono> (when uncertain)
            </li>
            <li>
              <strong>relative clauses w/ unknown antecedent:</strong>{' '}
              <Mono>busco un libro que sea…</Mono>
            </li>
          </TheoryList>
          <Callout variant="warn">
            <strong>WEIRDO</strong> — common mnemonic:{' '}
            <strong>W</strong>ishes, <strong>E</strong>motion,{' '}
            <strong>I</strong>mpersonal, <strong>R</strong>ecommendations,{' '}
            <strong>D</strong>oubt, <strong>O</strong>jalá.
          </Callout>
        </>
      ),
    },
    {
      id: 'form-regular',
      title: "how it's formed · regular",
      body: (
        <>
          <p>
            start from the <Mono>yo</Mono> form of the present indicative, drop
            the <Mono>-o</Mono>, and swap endings:
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
                <td>hable</td>
                <td>coma</td>
                <td>viva</td>
              </tr>
              <tr>
                <td>tú</td>
                <td>hables</td>
                <td>comas</td>
                <td>vivas</td>
              </tr>
              <tr>
                <td>él/ella</td>
                <td>hable</td>
                <td>coma</td>
                <td>viva</td>
              </tr>
              <tr>
                <td>nosotros</td>
                <td>hablemos</td>
                <td>comamos</td>
                <td>vivamos</td>
              </tr>
              <tr>
                <td>vosotros</td>
                <td>habléis</td>
                <td>comáis</td>
                <td>viváis</td>
              </tr>
              <tr>
                <td>ellos</td>
                <td>hablen</td>
                <td>coman</td>
                <td>vivan</td>
              </tr>
            </tbody>
          </ConjugationTable>
          <Callout>
            <strong>&ldquo;opposite vowel&rdquo; rule:</strong> -AR verbs take{' '}
            <Mono>e</Mono> endings, -ER/-IR verbs take <Mono>a</Mono> endings.
          </Callout>
        </>
      ),
    },
    {
      id: 'form-irregular',
      title: 'irregulars to memorize',
      body: (
        <>
          <p>
            six common verbs are fully irregular. mnemonic:{' '}
            <strong>DISHES</strong> —{' '}
            <Mono>dar, ir, ser, haber, estar, saber</Mono>.
          </p>
          <ConjugationTable>
            <thead>
              <tr>
                <th>infinitive</th>
                <th>yo</th>
                <th>tú</th>
                <th>él</th>
                <th>nosotros</th>
                <th>ellos</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>ser</td>
                <td>sea</td>
                <td>seas</td>
                <td>sea</td>
                <td>seamos</td>
                <td>sean</td>
              </tr>
              <tr>
                <td>estar</td>
                <td>esté</td>
                <td>estés</td>
                <td>esté</td>
                <td>estemos</td>
                <td>estén</td>
              </tr>
              <tr>
                <td>ir</td>
                <td>vaya</td>
                <td>vayas</td>
                <td>vaya</td>
                <td>vayamos</td>
                <td>vayan</td>
              </tr>
              <tr>
                <td>haber</td>
                <td>haya</td>
                <td>hayas</td>
                <td>haya</td>
                <td>hayamos</td>
                <td>hayan</td>
              </tr>
              <tr>
                <td>saber</td>
                <td>sepa</td>
                <td>sepas</td>
                <td>sepa</td>
                <td>sepamos</td>
                <td>sepan</td>
              </tr>
              <tr>
                <td>dar</td>
                <td>dé</td>
                <td>des</td>
                <td>dé</td>
                <td>demos</td>
                <td>den</td>
              </tr>
            </tbody>
          </ConjugationTable>
          <p>
            stem-changing verbs (e→ie, o→ue) keep their changes in subjunctive.
            spelling-change verbs (-car, -gar, -zar) shift to{' '}
            <Mono>-que, -gue, -ce</Mono>.
          </p>
        </>
      ),
    },
    {
      id: 'examples',
      title: 'examples in context',
      body: (
        <>
          <Example>
            <Example.ES>
              No creo que <Hilite>tenga</Hilite> tiempo hoy.
            </Example.ES>
            <Example.EN>I don&apos;t think I have time today.</Example.EN>
            <Example.Note>
              &ldquo;no creo que&rdquo; → doubt → subjunctive of <em>tener</em>.
            </Example.Note>
          </Example>
          <Example>
            <Example.ES>
              Espero que mis amigos <Hilite>vengan</Hilite> a la fiesta.
            </Example.ES>
            <Example.EN>I hope my friends come to the party.</Example.EN>
            <Example.Note>
              &ldquo;esperar que&rdquo; → wish/hope → subjunctive of{' '}
              <em>venir</em>.
            </Example.Note>
          </Example>
          <Example>
            <Example.ES>
              Es importante que tú <Hilite>digas</Hilite> la verdad.
            </Example.ES>
            <Example.EN>It&apos;s important that you tell the truth.</Example.EN>
            <Example.Note>
              impersonal expression → subjunctive of <em>decir</em>.
            </Example.Note>
          </Example>
          <Example>
            <Example.ES>
              Quiero un coche que <Hilite>gaste</Hilite> poco combustible.
            </Example.ES>
            <Example.EN>I want a car that uses little fuel.</Example.EN>
            <Example.Note>
              non-specific antecedent (any car like that) → subjunctive in the
              relative clause.
            </Example.Note>
          </Example>
        </>
      ),
    },
    {
      id: 'pitfalls',
      title: 'common pitfalls',
      body: (
        <TheoryList>
          <li>
            <strong>same subject?</strong> use the infinitive, not subjunctive:{' '}
            <Mono>quiero ir</Mono>, not <Mono>quiero que vaya</Mono>.
          </li>
          <li>
            <strong>creo que</strong> (affirmative) takes <em>indicative</em>:{' '}
            <Mono>creo que viene</Mono>. only <Mono>no creo que</Mono> triggers
            subjunctive.
          </li>
          <li>
            <strong>cuando</strong> + future event → subjunctive:{' '}
            <Mono>cuando llegue, te llamo</Mono>. about a habit → indicative.
          </li>
          <li>
            <strong>aunque</strong> + uncertain → subjunctive;{' '}
            <strong>aunque</strong> + known fact → indicative.
          </li>
        </TheoryList>
      ),
    },
  ],
};

export default subjunctive;
