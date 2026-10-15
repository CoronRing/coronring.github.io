/**
 * NewsRing, as this site consumes it.
 *
 * NewsRing (github.com/CoronRing/NewsRing) publishes a fresh digest every
 * morning to its own GitHub Pages site, at fixed URLs that always mean
 * "today". This site never rebuilds for it: the News Today post and the deck's
 * NewsRing frame fetch the feed when they are viewed. Both read the URLs from
 * here so a move happens in one place.
 */

const BASE = 'https://coronring.github.io/NewsRing/';

export const NEWSRING = {
  /** The newest digest as JSON (`version: 1`). Served with `Access-Control-Allow-Origin: *`. */
  feed: `${BASE}news_today.json`,
  /** Today's top stories card, 1200×630. */
  card: `${BASE}today.png`,
  /** Today's digest as a page on the NewsRing site. */
  page: `${BASE}today.html`,
  repo: 'https://github.com/CoronRing/NewsRing',
} as const;

/** One source on the dial. */
export interface NewsSource {
  /** As NewsRing names it, which is what a story's `source` field carries. */
  readonly name: string;
  /** Short enough to set on the dial. */
  readonly short: string;
  /** Hosts its articles live on, to place a card headline (which carries only a link). */
  readonly hosts: readonly string[];
}

/**
 * The sources the author's NewsRing reads.
 *
 * Mirrors the enabled sources in NewsRing's `newsring.toml`, in its order. The
 * deck draws one tick per entry, so the count on the ring is the count the
 * digest reports, and a story is drawn arriving from the tick it came from.
 */
export const NEWSRING_SOURCES: readonly NewsSource[] = [
  { name: 'Hacker News (AI)', short: 'HN AI', hosts: ['news.ycombinator.com'] },
  { name: 'Hacker News front page', short: 'HN front', hosts: [] },
  { name: 'Lobsters (AI)', short: 'Lobsters', hosts: ['lobste.rs'] },
  { name: 'HF Daily Papers', short: 'HF Papers', hosts: ['arxiv.org'] },
  { name: 'HF Trending Models', short: 'HF Models', hosts: [] },
  { name: 'Hugging Face Blog', short: 'HF Blog', hosts: ['huggingface.co'] },
  { name: 'OpenAI News', short: 'OpenAI', hosts: ['openai.com'] },
  { name: 'Google DeepMind', short: 'DeepMind', hosts: ['deepmind.google'] },
  { name: 'Google AI Blog', short: 'Google AI', hosts: ['blog.google'] },
  { name: 'Google Gemini Blog', short: 'Gemini', hosts: [] },
  { name: 'Google Research', short: 'G Research', hosts: ['research.google'] },
  { name: 'Anthropic News', short: 'Anthropic', hosts: ['anthropic.com'] },
  { name: 'Anthropic Research', short: 'Anth. Research', hosts: [] },
  { name: 'Meta AI', short: 'Meta AI', hosts: ['ai.meta.com'] },
  { name: 'Mistral AI', short: 'Mistral', hosts: ['mistral.ai'] },
  { name: 'Microsoft Research', short: 'MS Research', hosts: ['microsoft.com'] },
  {
    name: 'NVIDIA Developer',
    short: 'NVIDIA',
    hosts: ['developer.nvidia.com', 'blogs.nvidia.com', 'nvidia.com'],
  },
  { name: 'AWS Machine Learning', short: 'AWS ML', hosts: ['aws.amazon.com'] },
  { name: 'Cloudflare AI', short: 'Cloudflare', hosts: ['blog.cloudflare.com'] },
  { name: 'PyTorch', short: 'PyTorch', hosts: ['pytorch.org'] },
  { name: 'vLLM releases', short: 'vLLM', hosts: [] },
  { name: 'llama.cpp releases', short: 'llama.cpp', hosts: [] },
  { name: 'Ollama releases', short: 'Ollama', hosts: ['ollama.com'] },
  { name: 'Transformers releases', short: 'Transformers', hosts: [] },
  { name: 'Triton releases', short: 'Triton', hosts: [] },
  { name: 'LangChain releases', short: 'LangChain', hosts: [] },
  { name: 'BAIR Blog', short: 'BAIR', hosts: ['bair.berkeley.edu'] },
  { name: 'Simon Willison', short: 'Willison', hosts: ['simonwillison.net'] },
  { name: 'Lilian Weng', short: 'Lilian Weng', hosts: ['lilianweng.github.io'] },
  { name: 'Sebastian Raschka', short: 'Raschka', hosts: ['magazine.sebastianraschka.com'] },
  { name: 'Eugene Yan', short: 'Eugene Yan', hosts: ['eugeneyan.com'] },
  { name: 'Chip Huyen', short: 'Chip Huyen', hosts: ['huyenchip.com'] },
  { name: 'Ars Technica', short: 'Ars Technica', hosts: ['arstechnica.com'] },
  { name: 'The Verge (AI)', short: 'The Verge', hosts: ['theverge.com'] },
  { name: 'MIT Technology Review (AI)', short: 'MIT Tech Review', hosts: ['technologyreview.com'] },
];

/** The parts of the feed the site reads. Everything else in it is ignored. */
export interface NewsFeed {
  readonly version: number;
  readonly date: string;
  readonly title: string;
  readonly headlines: ReadonlyArray<{
    readonly kicker: string;
    readonly headline: string;
    readonly blurb: string;
    readonly link: { readonly label: string; readonly url: string };
  }>;
  readonly stories: ReadonlyArray<{
    readonly headline: string;
    readonly why_it_matters: string;
    readonly source: string;
    readonly links: ReadonlyArray<{ readonly label: string; readonly url: string }>;
  }>;
  readonly stats: string;
}
