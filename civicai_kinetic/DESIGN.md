```markdown
# Design System Documentation: The Ethereal Interface

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Digital Architect."** It is an editorial approach to high-tech utility, moving away from the "cluttered dashboard" trope and toward a serene, hyper-organized space. 

This system rejects the rigidity of standard grids in favor of **Intentional Asymmetry** and **Tonal Depth**. We do not use lines to separate ideas; we use light, blur, and layering. The goal is a mobile experience that feels less like software and more like a high-end physical object—a piece of precision-machined frosted glass suspended in light.

### Breaking the Template
*   **Asymmetric Breathing Room:** Elements should gravitate toward a "weighted" side of the screen, leaving intentional white space to guide the eye.
*   **Overlapping Architecture:** Cards and components should subtly overlap (using z-index layering) to create a sense of three-dimensional space.
*   **Scale Contrast:** We pair massive, airy display type with hyper-legible, functional labels to create an authoritative editorial rhythm.

---

## 2. Colors & Surface Philosophy
The palette is rooted in a "High-Tech Professionalism," utilizing a sophisticated spectrum of blues and grays to evoke trust and precision.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders for sectioning or containment. Boundaries must be defined solely through:
1.  **Background Shifts:** Placing a `surface-container-low` card on a `surface` background.
2.  **Tonal Transitions:** Using the gradient tokens to define the end of one zone and the start of another.

### Surface Hierarchy & Nesting
Treat the UI as physical layers of frosted material.
*   **Base:** `surface` (#f8f9fa) is the canvas.
*   **Level 1:** `surface-container-low` (#f3f4f5) for large grouping areas.
*   **Level 2:** `surface-container-highest` (#e1e3e4) for interactive elements that need to "pop."
*   **The Glass Rule:** For floating components (modals, FABs, navigation bars), use a semi-transparent `surface_container_lowest` (White at 70% opacity) combined with a `backdrop-filter: blur(20px)`.

### Signature Textures
Main CTAs and Hero sections must not use flat colors. Use a **Linear Gradient (135°)**:
*   `primary` (#0058bc) → `primary_container` (#0070eb)
This adds "soul" and depth, preventing the UI from looking like a generic wireframe.

---

## 3. Typography
We use a dual-font strategy to balance futuristic character with high-utility readability.

*   **Display & Headlines (`Space Grotesk`):** Used for "The Statement." This typeface provides the high-tech, geometric edge. Use `display-lg` (3.5rem) for high-impact welcome screens to create a premium editorial feel.
*   **Body & UI (`Inter`):** Used for "The Information." Inter provides the clinical clarity required for data-heavy civic interactions.
*   **Hierarchy Note:** Always maintain a minimum 2:1 ratio between headline size and body size to ensure the "Editorial" look.

---

## 4. Elevation & Depth
Depth is achieved through **Tonal Layering** rather than structural scaffolding.

### The Layering Principle
Instead of a shadow, place a `surface_container_lowest` (#ffffff) card on a `surface_container` (#edeeef) background. This "soft lift" feels more modern and less "skeuomorphic" than 2010-era shadows.

### Ambient Shadows
When an element must float (e.g., a Floating Action Button):
*   **Blur:** 40px to 60px.
*   **Opacity:** 4% to 8%.
*   **Color:** Use a tinted version of `on_surface` (e.g., a deep navy tint) rather than pure black to keep the shadows "airy."

### The Ghost Border Fallback
If accessibility requires a container edge, use a **Ghost Border**: 
*   `outline_variant` at 15% opacity. 
*   **Forbidden:** 100% opaque borders or high-contrast dividers.

---

## 5. Components

### Cards & Containers
*   **Style:** No borders. Large corner radius (`xl`: 3rem for main containers, `lg`: 2rem for inner cards).
*   **Separation:** Use vertical whitespace from the spacing scale (e.g., 32px or 48px) instead of divider lines.
*   **Glass Effect:** Apply `backdrop-filter: blur(12px)` to any card sitting over a mesh gradient background.

### Buttons
*   **Primary:** Gradient-filled (`primary` to `primary_container`) with `full` (9999px) border-radius.
*   **Secondary:** Ghost style—no fill, only the `outline` token at 20% opacity, with `on_surface` text.
*   **State:** On hover/tap, the gradient should shift brightness, not color.

### Floating Action Button (FAB)
*   **Design:** A "Glassmorphic" circle. Use `surface_container_lowest` at 60% opacity with a heavy backdrop blur.
*   **Icon:** Use a crisp, 2px stroke weight icon in `primary` blue.

### Input Fields
*   **Visuals:** Minimalist. A simple `surface_variant` background with a `sm` (0.5rem) radius. 
*   **Focus State:** Transition the background to `primary_fixed` and add a subtle `primary` glow (ambient shadow).

---

## 6. Do’s and Don’ts

### Do
*   **DO** use whitespace as a functional tool to group items.
*   **DO** lean into "Over-sized" headings for a premium feel.
*   **DO** use semi-transparency and blur to indicate that an element is "above" the main content.
*   **DO** use the `secondary` green (#006e28) sparingly for high-success affirmations only.

### Don't
*   **DON’T** use a 1px solid divider line. Ever.
*   **DON’T** use sharp 90-degree corners; they break the "Organic Tech" aesthetic.
*   **DON’T** use high-opacity drop shadows; they look "dirty" on light-gray surfaces.
*   **DON’T** crowd the screen. If a view feels busy, increase the background-color contrast between sections instead of adding borders.

---

### Director's Final Note
This design system is about the **unseen.** It is about the tension between the blur of the background and the surgical precision of the typography. Every pixel should feel like it was placed with a purpose. If an element doesn't serve a functional or high-level aesthetic goal, remove it. Keep it light, keep it glass, keep it human.```