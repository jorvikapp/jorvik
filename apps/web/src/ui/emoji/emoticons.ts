/**
 * Text emoticons -> Unicode emoji, applied once when a message is sent.
 *
 * The substitution happens in the plain-text body rather than in
 * formatted_body, so what goes out is a real Unicode character that every
 * client renders. That is the opposite of the custom pack shortcodes in
 * formatMessageWithEmojis, which have no Unicode equivalent and so must be
 * sent as an <img> tag in HTML.
 */

/** `:-)` and `:=)` are the "with nose" spellings of `:)`. */
const NOSES = ["", "-", "="];

interface Face {
    eyes: string;
    mouths: string[];
    emoji: string;
}

const FACES: Face[] = [
    { eyes: ":", mouths: [")", "]"], emoji: "\u{1F642}" },
    { eyes: ":", mouths: ["D"], emoji: "\u{1F603}" },
    { eyes: ":", mouths: ["(", "["], emoji: "\u{1F641}" },
    { eyes: ":", mouths: ["P", "p"], emoji: "\u{1F61B}" },
    { eyes: ":", mouths: ["O", "o"], emoji: "\u{1F62E}" },
    { eyes: ":", mouths: ["/", "\\"], emoji: "\u{1F615}" },
    { eyes: ":", mouths: ["|"], emoji: "\u{1F610}" },
    { eyes: ":", mouths: ["*"], emoji: "\u{1F618}" },
    { eyes: ";", mouths: [")"], emoji: "\u{1F609}" },
    { eyes: ";", mouths: ["D"], emoji: "\u{1F604}" },
];

/** Shapes that do not follow the eyes/nose/mouth pattern. */
const LITERALS: Record<string, string> = {
    ":'(": "\u{1F622}",
    ">:(": "\u{1F620}",
    ":3": "\u{1F63A}",
    "<3": "\u{2764}\u{FE0F}",
    "</3": "\u{1F494}",
    "\\o/": "\u{1F64C}",
    xD: "\u{1F606}",
    XD: "\u{1F606}",
};

const EMOTICONS = ((): Map<string, string> => {
    const map = new Map<string, string>();

    for (const face of FACES) {
        for (const nose of NOSES) {
            for (const mouth of face.mouths) {
                map.set(`${face.eyes}${nose}${mouth}`, face.emoji);
            }
        }
    }

    for (const [emoticon, emoji] of Object.entries(LITERALS)) {
        map.set(emoticon, emoji);
    }

    return map;
})();

function escapeForRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Requiring whitespace (or a string edge) on both sides is what keeps URLs
 * intact: `http://host` cannot match `:/` because the colon is preceded by
 * "p", and a URL never contains the whitespace a match would need. Longest
 * alternatives come first so `:-)` wins over `:)` and `</3` over `<3`.
 */
const EMOTICON_PATTERN = new RegExp(
    `(?<=^|\\s)(?:${[...EMOTICONS.keys()]
        .sort((left, right) => right.length - left.length)
        .map(escapeForRegExp)
        .join("|")})(?=$|\\s)`,
    "g",
);

export function replaceEmoticons(text: string): string {
    if (!text) {
        return text;
    }

    return text.replace(EMOTICON_PATTERN, (match) => EMOTICONS.get(match) ?? match);
}
