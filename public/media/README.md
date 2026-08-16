# Media

Drop images and video here. Every slot on the site renders a designed
placeholder until the real file exists, and the placeholder prints the exact
path it is waiting for — so you never have to guess a filename.

## Where files go

```
public/media/
├── projects/<project-id>/hero.webp     Card + detail lead image
├── projects/<project-id>/01.webp       Gallery, numbered in display order
├── projects/<project-id>/01.mp4        Video works in the same slots
└── resume/<slug>.webp                  Optional logo/photo for a timeline row
```

`<project-id>` is the MDX filename without its extension —
`src/content/projects/particle-wave.mdx` → `particle-wave`.

## Wiring a file up

Add the path to the project's frontmatter. Nothing else changes:

```yaml
hero:
  src: /media/projects/particle-wave/hero.webp
  alt: The particle engine rendering a corona point cloud
  ratio: '16/9'
  caption: Live capture of the engine responding to the cursor.

gallery:
  - src: /media/projects/particle-wave/01.mp4
    poster: /media/projects/particle-wave/01-poster.webp
    alt: A click wave propagating through the field
    ratio: '4/3'
```

`alt` is not optional in practice — it is what a screen reader announces and
what shows if the file 404s. Describe the content, not the medium ("the engine
responding to the cursor", not "screenshot").

## Formats and sizes

| Use                | Format                   | Target width        |
| ------------------ | ------------------------ | ------------------- |
| Card / hero stills | `.webp` (or `.avif`)     | 1600px              |
| Gallery stills     | `.webp`                  | 1200px              |
| Clips              | `.mp4` (h.264) + `.webm` | 1280px, under ~4 MB |

Video slots autoplay muted, loop, and play inline — treat them as moving
stills, not as things anyone will hear. Always ship a `poster` so the slot is
not blank on a slow connection.

Keep the aspect ratio matching the `ratio` field, otherwise the image is
cropped to fill (`object-fit: cover`).
