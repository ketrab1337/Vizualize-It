-- Dodaje per-projekt 4 punkty perspektywy ściany.
-- Format: JSON tablica 8 floatów [x0,y0, x1,y1, x2,y2, x3,y3] znormalizowanych
-- do wymiarów tła (0..1). Kolejność: TL, TR, BR, BL (top-left, top-right,
-- bottom-right, bottom-left).
--
-- NULL = brak perspektywy (SVG kompozytowany na płasko, jak przed migracją).
-- Niezmienne dla projektów bez tła.
ALTER TABLE projects ADD COLUMN perspective_corners TEXT NULL;
