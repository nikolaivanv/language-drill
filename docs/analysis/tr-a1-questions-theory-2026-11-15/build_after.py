#!/usr/bin/env python3
"""Build after.json from before.json for tr-a1-questions (2026-11-15).

Adds the question patterns the exercise pool drills but the page never taught:
alternative (either/or) questions with mI … mI / yoksa, mI on a focused
non-predicate word, the particle acaba, and the rest of the A1 WH-words.
Grounded in Göksel & Kerslake §19.1.2–19.1.4, §19.2, §19.2.1.3, §19.5.2.

Usage: python3 -I build_after.py   (run from this directory)
"""
import copy, json, os

HERE = os.path.dirname(os.path.abspath(__file__))


def t(s):
    return {"kind": "text", "text": s}


def hl(s):
    return {"kind": "hilite", "children": [t(s)]}


def em(s):
    return {"kind": "em", "children": [t(s)]}


def strong(s):
    return {"kind": "strong", "children": [t(s)]}


def para(*inl):
    return {"kind": "paragraph", "text": list(inl)}


def table(head, rows):
    return {"kind": "conjugation-table", "head": head, "rows": rows}


def example(target, en, note):
    return {"kind": "example", "target": target, "en": en, "note": note}


before = json.load(open(os.path.join(HERE, "before.json")))
page = copy.deepcopy(before)
sec = {s["id"]: s for s in page["sections"]}

page["subtitle"] = "mı, WH-words, either/or questions and acaba"

# --- what is it? -------------------------------------------------------------
sec["what-is-it"]["body"][0]["text"].extend(
    [
        t(" Two more patterns build on mI. In an "),
        strong("either/or question"),
        t(" mI follows each option, and the options can be joined by "),
        hl("yoksa"),
        t(" ('or'): Otobüse mi biniyorsun, yoksa trene mi? And the invariable word "),
        hl("acaba"),
        t(" ('I wonder') can be added to any question, yes/no or WH, to make it sound tentative or curious."),
    ]
)

# --- when to use it ----------------------------------------------------------
when_items = sec["when-to-use-it"]["body"][0]["items"]
when_items.extend(
    [
        [
            para(
                strong("Focus questions — mI after another word."),
                t(" mI can also follow another word in the sentence (a person, a place, a time) instead of the verb. Then only that word is questioned, and the rest is taken for granted: "),
                em("Ankara'ya mı gidiyorsun?"),
                t(" ('Is it to Ankara that you're going?'). The focused word normally sits just before the verb. Here mI stays bare: the person ending remains on the verb, in every tense."),
            )
        ],
        [
            para(
                strong("Either/or (alternative) questions."),
                t(" To offer a choice, put mI after each option. "),
                hl("yoksa"),
                t(" ('or') between them is optional: "),
                em("Çay mı kahve mi istiyorsun?"),
                t(" / "),
                em("Çay mı istiyorsun, yoksa kahve mi?"),
                t(" The options can also be a predicate and its negative, to mean 'or not': "),
                em("Geliyor musun, gelmiyor musun?"),
                t(", "),
                em("Var mı, yok mu?"),
            )
        ],
        [
            para(
                strong("acaba — 'I wonder'."),
                t(" Add "),
                hl("acaba"),
                t(" to a yes/no or WH question to show doubt or curiosity. It usually stands at the start or the end of the sentence. It never changes form, and it does not replace mI: a yes/no question keeps its mI ("),
                em("Acaba otobüs geç mi?"),
                t("), and a WH question still has none ("),
                em("Ali nerede acaba?"),
                t(")."),
            )
        ],
    ]
)

# --- formation ---------------------------------------------------------------
form = sec["formation"]["body"]
# Replace the 6-row WH table with the fuller A1 set.
wh_idx = next(
    i for i, b in enumerate(form) if b["kind"] == "conjugation-table" and b["head"] == ["question word", "meaning"]
)
form[wh_idx] = table(
    ["question word", "meaning", "example"],
    [
        ["ne", "what", "Bu ne?"],
        ["kim", "who", "Bu kim?"],
        ["nerede", "where (at)", "Ali nerede?"],
        ["nereye", "where (to)", "Nereye gidiyorsun?"],
        ["nereden", "where (from)", "Nereden geliyorsun?"],
        ["ne zaman", "when", "Ne zaman geliyorsun?"],
        ["nasıl", "how", "Bugün hava nasıl?"],
        ["neden / niye / niçin", "why", "Neden gülüyorsun?"],
        ["hangi", "which", "Hangi kitabı okuyorsun?"],
        ["kaç", "how many (+ singular noun, often with tane); what time (saat kaç)", "Kaç kardeşin var?"],
        ["ne kadar", "how much", "Bu çanta ne kadar?"],
    ],
)
form[wh_idx - 1] = para(
    t("Common WH-words at A1. The answer slot is taken by the WH-word, so the verb keeps its normal person ending and no mI is added. "),
    em("nere-"),
    t(" ('where') normally carries a case ending: nerede (at), nereye (to), nereden (from)."),
)

form.extend(
    [
        para(
            t("Where mI goes decides where the person ending goes. When mI follows the predicate, the ending moves onto mI (also in other tenses you will meet later: gelir misin?, gelecek misin?), except in the -dı past and with 3rd-person plural -lAr. When mI follows any other word (a focused word, or an option in an either/or question), mI is bare and the verb keeps its ending. mI always harmonises with the word right before it."),
        ),
        table(
            ["mI follows…", "example", "person ending"],
            [
                ["the predicate (present)", "Ankara'ya gidiyor musun?", "on mI (mu-sun)"],
                ["the predicate (-dı past)", "Ankara'ya gittin mi?", "on the verb (gitti-n)"],
                ["a focused word (a → mı)", "Ankara'ya mı gidiyorsun?", "on the verb (gidiyor-sun)"],
                ["a focused word (e → mi)", "Otobüse mi biniyorsun?", "on the verb"],
                ["a focused word (u → mu)", "Okulu mu seviyorsun?", "on the verb"],
                ["a focused word (ü → mü)", "Bugün mü geliyorsun?", "on the verb"],
                ["a focused subject (past)", "Sen mi yaptın?", "on the verb (yaptı-n)"],
                ["each option (either/or)", "Ankara'ya mı İstanbul'a mı gidiyorsun?", "on the verb"],
            ],
        ),
        para(
            t("In an either/or question, the shared verb is usually said once: after the first option ("),
            em("Otobüse mi biniyorsun, yoksa trene mi?"),
            t(") or after the last one ("),
            em("Otobüse mi trene mi biniyorsun?"),
            t("). When the options are the predicate itself, each one is a complete yes/no question and follows the normal rules: "),
            em("Geliyor musun, gelmiyor musun?"),
            t(" (ending on mI), "),
            em("Geldin mi, gelmedin mi?"),
            t(" (ending on the verb)."),
        ),
    ]
)

# Explain the -y- buffer in miyim/miyiz (the table already shows it).
for i, b in enumerate(form):
    if b["kind"] == "paragraph" and b["text"][0]["text"].startswith("For yes/no questions, the person endings"):
        form[i] = para(
            t("For yes/no questions, the person endings that normally attach to the predicate are instead attached to mI; only 3rd-person plural -lAr stays on the predicate. Because mI ends in a vowel, a buffer "),
            hl("-y-"),
            t(" comes before the vowel-initial endings -Im and -Iz: mi-y-im, mu-y-uz. The table below shows the pattern for a nominal predicate and for the present-continuous tense."),
        )
        break
else:
    raise SystemExit("person-table paragraph not found")

# --- examples in context ------------------------------------------------------
sec["examples-in-context"]["body"].extend(
    [
        example(
            [t("Otobüse "), hl("mi"), t(" biniyorsun, yoksa trene "), hl("mi"), t("?")],
            "Are you taking the bus or the train?",
            [
                t("Either/or question. mI follows each option ("),
                em("otobüse"),
                t(" → mi, "),
                em("trene"),
                t(" → mi), and "),
                em("yoksa"),
                t(" joins them. The verb is said only once and keeps its ending -sun, because mI is not on the predicate."),
            ],
        ),
        example(
            [t("Çay "), hl("mı"), t(" kahve "), hl("mi"), t(" istiyorsun?")],
            "Do you want tea or coffee?",
            [
                t("The same pattern without "),
                em("yoksa"),
                t(", with the verb after the last option. Each mI harmonises with its own word: "),
                em("çay"),
                t(" → mı, "),
                em("kahve"),
                t(" → mi."),
            ],
        ),
        example(
            [t("Geliyor "), hl("musun"), t(", gelmiyor "), hl("musun"), t("?")],
            "Are you coming or not?",
            [
                t("The two options are the predicate and its negative, so each is a full present-tense yes/no question with the ending on mI."),
            ],
        ),
        example(
            [t("Ankara'ya "), hl("mı"), t(" gidiyorsun?")],
            "Is it to Ankara that you're going?",
            [
                t("Focus question. mI follows "),
                em("Ankara'ya"),
                t(", which sits just before the verb. The speaker already knows you are going somewhere and asks only about the destination. Compare "),
                em("Ankara'ya gidiyor musun?"),
                t(" — a plain question about the whole sentence, with the ending on mI."),
            ],
        ),
        example(
            [t("Sen "), hl("mi"), t(" yaptın?")],
            "Was it you who did it?",
            [
                t("Focus on the subject. mI is bare and the person ending stays on the verb "),
                em("yaptın"),
                t("."),
            ],
        ),
        example(
            [hl("Acaba"), t(" otobüs geç mi?")],
            "I wonder if the bus is late.",
            [
                em("Acaba"),
                t(" at the start of a yes/no question. The question still needs mI after "),
                em("geç"),
                t("."),
            ],
        ),
        example(
            [t("Ali nerede "), hl("acaba"), t("?")],
            "I wonder where Ali is.",
            [
                em("Acaba"),
                t(" at the end of a WH question. There is still no mI, because "),
                em("nerede"),
                t(" already makes it a question."),
            ],
        ),
    ]
)

# --- common pitfalls -----------------------------------------------------------
pit = sec["common-pitfalls"]["body"]
pit[0]["items"].extend(
    [
        [
            para(
                strong("Putting the person ending on a focus or either/or mI."),
                t(" When mI follows a word other than the predicate, it takes no ending. "),
                hl("Ankara'ya mısın gidiyor?"),
                t(" is wrong; the correct form is "),
                hl("Ankara'ya mı gidiyorsun?"),
                t("."),
            )
        ],
        [
            para(
                strong("Dropping the second mI in an either/or question."),
                t(" Every option needs its own mI. "),
                hl("Otobüse mi biniyorsun, yoksa tren?"),
                t(" is wrong; say "),
                hl("Otobüse mi biniyorsun, yoksa trene mi?"),
                t("."),
            )
        ],
        [
            para(
                strong("Leaving out mI after acaba."),
                t(" acaba adds 'I wonder', but in standard Turkish a yes/no question with acaba still takes mI. Write "),
                hl("Acaba otobüs geç mi?"),
                t(", not "),
                hl("Acaba otobüs geç?"),
                t(" acaba itself never changes form."),
            )
        ],
    ]
)
callout = pit[1]
assert callout["kind"] == "callout"
callout["children"] = [
    para(
        t("A quick rule of thumb: when mI follows the predicate, the person ending goes on mI (öğrenci misin?, geliyor musun?), except in the -dı past (gittin mi?) and with 3rd-person plural -lAr, which comes before mI (geliyorlar mı?). When mI follows any other word, the verb keeps its own ending and mI is bare (Ankara'ya mı gidiyorsun?)."),
    )
]

json.dump(page, open(os.path.join(HERE, "after.json"), "w"), ensure_ascii=False, indent=1)
print("wrote after.json")
