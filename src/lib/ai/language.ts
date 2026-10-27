/**
 * The language rules every AI prompt shares (Ask box, assistant, document, receipt and notice
 * reading, meeting agendas). Tanzanian users write and speak Kiswahili, Sheng and English, often
 * mixed inside one sentence. Pure text, no imports, so prompts and tests can use it anywhere.
 */

/** Understanding what people write or say. */
export const READS_KISWAHILI =
  "People may write or speak Kiswahili, Sheng, or Kiswahili mixed with English inside one sentence, as is usual in Tanzania; understand all of these fluently and read for meaning, not word for word.";

/** Which language to answer in. */
export const ANSWER_LANGUAGE =
  "Answer in the language of the question (English, Kiswahili, or the same mix of both) unless the person asks for another language.";

/** How summaries read. */
export const SUMMARY_STYLE = "Write any summary as clear, well-organised paragraphs in plain words, not as a pile of fragments.";
