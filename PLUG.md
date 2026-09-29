---
name: Library/TeenKode/Constellation
tags: meta/library
description: A living graph view of your space — groups, a page card with working checkboxes, a timeline, overdue and upcoming marks.
website: https://github.com/TeenKode/silverbullet-constellation
files:
- constellation.plug.js
---
# Constellation

A living graph view of your space: nodes gently drift, neighbours follow a dragged node, and the layout stays
where you left it. Open it with **Constellation: Open Graph** (full screen) or **Constellation: Toggle Side Graph**.

* Colored groups with a legend that doubles as a filter, “Nearby” mode, search, orphans on demand.
* Click a node — a card with the page content: queries and widgets are rendered, **task checkboxes work**.
* A timeline slider, recent pages brighter.
* A red ring on pages with overdue tasks, “in N days” on upcoming events.
* Links from task attributes: `[who: Ann]` can link the page to `People/Ann`.
* English and Russian interface, light and dark theme, settings panel (⚙).

Documentation: https://github.com/TeenKode/silverbullet-constellation

## Configuration
Everything is optional. Without configuration pages are grouped by their top-level folder. Put this in a
`space-lua` block (for example on your `CONFIG` page) and adjust:

```lua
config.set("constellation", {
  language = "auto",          -- "auto" (browser), "en" or "ru"
  openOnStart = false,        -- open the full-screen graph when the space opens on the start page
  groups = {                  -- first match wins; pages matching none go to "other"
    { id = "project", name = "Projects", one = "Project", prefix = "Projects/" },
    { id = "person", name = "People", one = "Person", prefix = "People/", undated = true },
    { id = "journal", name = "Journal", prefix = "Journal/", color = "#22c55e", darkColor = "#4ade80" },
    { id = "other", name = "Notes", one = "Note" },
    { id = "meta", name = "Meta", pages = { "index" }, hidden = true },
  },
  taskLinks = { who = "People/" },                     -- [who: Ann] links the page to People/Ann
  dueAttributes = { "due", "deadline" },               -- overdue ring
  upcoming = { attribute = "date", days = 14, prefix = "Events/", mirror = "Projects/" },
})
```
