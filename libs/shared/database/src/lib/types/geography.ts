import { customType } from 'drizzle-orm/pg-core';

/** WGS84 point stored as PostGIS `geography(Point, 4326)`. */
export type Point = { lat: number; lng: number };

/** Drizzle custom column type mapping application {@link Point} values to PostGIS geography. */
export const geography = customType<{ data: Point; driverData: string }>({
  /** SQL column type for migrations and DDL. */
  dataType() {
    return 'geography(Point, 4326)';
  },
  /** Serializes a {@link Point} to the EWKT string Postgres expects for geography inserts. */
  toDriver(value: Point): string {
    return `SRID=4326;POINT(${value.lng} ${value.lat})`;
  },
  /** Parses a PostGIS geography value returned by the driver into a {@link Point}. */
  fromDriver(value: string): Point {
    const match = value.match(/POINT\(([^ ]+) ([^ ]+)\)/);
    if (!match) {
      throw new Error(`Invalid geography value: ${value}`);
    }
    return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
  },
});
