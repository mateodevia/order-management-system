import { customType } from 'drizzle-orm/pg-core';

export type Point = { lat: number; lng: number };

export const geography = customType<{ data: Point; driverData: string }>({
  dataType() {
    return 'geography(Point, 4326)';
  },
  toDriver(value: Point): string {
    return `SRID=4326;POINT(${value.lng} ${value.lat})`;
  },
  fromDriver(value: string): Point {
    const match = value.match(/POINT\(([^ ]+) ([^ ]+)\)/);
    if (!match) {
      throw new Error(`Invalid geography value: ${value}`);
    }
    return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
  },
});
