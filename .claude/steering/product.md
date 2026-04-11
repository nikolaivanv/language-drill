Language Drill — Architecture & Tech Stack

## 1. Product Context

A serverless, AI-powered language learning app targeting active practice over passive consumption. Primary user is the author; designed to be portfolio-worthy and shareable. Scales to public use without re-architecting.

## 2. Competitive edge

---

The Landscape

┌─────────────┬────────────────────────────────┬─────────────────────────────────────────────────────┐
│ App │ Good at │ Fails at │
├─────────────┼────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Duolingo │ Habit formation, beginners │ Passive clicking, gamification plateau, weak at B1+ │
├─────────────┼────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Babbel │ Structured curriculum │ Still passive, no AI feedback, rigid │
├─────────────┼────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Pimsleur │ Audio/speaking methodology │ Expensive, no writing, no interactivity │
├─────────────┼────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Anki │ Spaced repetition │ No content, steep UX, DIY only │
├─────────────┼────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Clozemaster │ Intermediate cloze practice │ Ugly, no production, limited feedback │
├─────────────┼────────────────────────────────┼─────────────────────────────────────────────────────┤
│ italki │ Real human feedback │ $30–60/hr, scheduling friction │
├─────────────┼────────────────────────────────┼─────────────────────────────────────────────────────┤
│ ChatGPT │ Flexible conversation practice │ No structure, no progress tracking, no curriculum │
└─────────────┴────────────────────────────────┴─────────────────────────────────────────────────────┘

---

The Real Gap: The Intermediate Plateau

This is the most underserved problem in language learning, and it's well-documented. It hits when:

- You've finished beginner courses but can't speak fluently under pressure
- You recognize words but can't produce them on demand
- You understand slow speech but not natural speed
- You know grammar rules but make errors anyway

Duolingo loses 90%+ of users before B1. The few who push past it have nowhere good to go. This is your market.

---

Your Defensible Edge

You have several differentiators, but they're only powerful in combination. Individually they exist elsewhere:

1. Active production over passive recognition
   Every app defaults to multiple choice because it's easy to grade. Your app forces writing and speaking — the only way to build fluency. AI evaluation makes this scalable. This is a methodological bet,
   and it's the right one. Research consistently shows output practice beats input recognition at intermediate levels.

2. Honest skill-based progress
   Not "you completed lesson 47." Instead: "your subjunctive recall is 71%, improving." This is motivating for serious learners in a way XP streaks aren't — and it tells you exactly where to focus. No
   mainstream app does this well.

3. The polyglot angle
   You're learning 4 languages at different proficiency levels. No app is designed for this. The UX, the progress model, the exercise selection — everything in existing apps assumes one language. Leaning
   into this is a genuine niche with a passionate, underserved community (r/languagelearning has 2M+ members, heavily intermediate/polyglot).

4. Proven methodologies, not invented ones
   Spaced repetition, Cloze, Pimsleur-style audio — you're not inventing a new method, you're combining the best existing methods in one place with AI to make them adaptive and feedback-rich. That's a
   credible pitch.

---

The Positioning I'd Pitch

▎ "The practice app for serious language learners."
▎ Not for beginners clicking through cartoons. For people at B1–C1 who want to actually break through and speak — with AI that evaluates what you produce, not just what you recognize.

Or more simply: "What you do between italki sessions."

This reframes the competition away from Duolingo (you won't win a gamification war) and toward the tutor market — where the value proposition is "AI-level feedback at app-level price."

---

What to Avoid Claiming

- "Better than Duolingo for beginners" — you're not, don't fight that battle
- "All-in-one" — credibility requires focus, especially early
- "AI-powered" as a differentiator alone — everyone says this now

---

Suggested Focus for V1

If you're showcasing this as a portfolio project or early product: pick one language, one skill type, and nail the production + evaluation loop. The hardest and most impressive thing to demo is: user
speaks or writes something, AI evaluates it with nuanced feedback, progress updates. That single loop is more impressive than a broad feature set — and it's what validates the core thesis.
