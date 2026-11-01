import { describe, expect, it } from 'vitest';
import { calcular, diasSinJuntarse, sumarAmigos, tocaJuntarse, validar, type Persona } from './juntada';

const p = (nombre: string, pesos: number, participa = true): Persona => ({ id: nombre, nombre, puso: Math.round(pesos * 100), participa });

describe('calculadora', () => {
  it('compraron tres y se divide entre cuatro', () => {
    const r = calcular([p('Jesús', 50000), p('Pablo', 30000), p('Ricardo', 20000), p('Nico', 0)]);
    expect(r.total).toBe(10_000_000);
    expect(r.porCabeza).toBe(2_500_000);
    expect(r.saldo).toEqual({ Jesús: 2_500_000, Pablo: 500_000, Ricardo: -500_000, Nico: -2_500_000 });
    expect(r.transferencias).toEqual([
      { from: 'Nico', to: 'Jesús', amountCents: 2_500_000 },
      { from: 'Ricardo', to: 'Pablo', amountCents: 500_000 }
    ]);
  });

  it('el que compró pero no vino no paga su parte', () => {
    const r = calcular([p('Ana', 30000, false), p('Beto', 0), p('Caro', 0)]);
    expect(r.parte).toEqual({ Ana: 0, Beto: 1_500_000, Caro: 1_500_000 });
    expect(r.transferencias.reduce((a, t) => a + t.amountCents, 0)).toBe(3_000_000);
    expect(r.transferencias.every((t) => t.to === 'Ana')).toBe(true);
  });

  it('no pierde centavos cuando no divide exacto', () => {
    const r = calcular([p('a', 100), p('b', 0), p('c', 0)]);
    expect(Object.values(r.parte).reduce((x, y) => x + y, 0)).toBe(10_000);
    expect(Object.values(r.saldo).reduce((x, y) => x + y, 0)).toBe(0);
    expect(r.transferencias).toEqual([
      { from: 'b', to: 'a', amountCents: 3_333 },
      { from: 'c', to: 'a', amountCents: 3_333 }
    ]);
  });

  it('si todos pusieron lo mismo no hay transferencias', () => {
    expect(calcular([p('a', 1000), p('b', 1000)]).transferencias).toEqual([]);
  });

  it('sin gastos o sin participantes no rompe', () => {
    expect(calcular([p('a', 0), p('b', 0)]).transferencias).toEqual([]);
    expect(calcular([p('a', 100, false)]).transferencias).toEqual([]);
    expect(calcular([]).total).toBe(0);
  });
});

describe('aviso de juntada', () => {
  const hoy = new Date('2026-11-01T15:00:00');
  const j = (fecha: string) => ({ id: fecha, fecha, titulo: '', personas: [], saldada: false, creada: '' });
  it('cuenta los días desde la última juntada', () => {
    expect(diasSinJuntarse([j('2026-09-01'), j('2026-09-27')], hoy)).toBe(35);
    expect(diasSinJuntarse([], hoy)).toBeNull();
  });
  it('avisa al superar la frecuencia elegida', () => {
    const datos = { version: 1 as const, juntadas: [j('2026-09-27')], amigos: [], avisoDias: 30 };
    expect(tocaJuntarse(datos, hoy)).toBe(35);
    expect(tocaJuntarse({ ...datos, avisoDias: 45 }, hoy)).toBeNull();
    expect(tocaJuntarse({ ...datos, juntadas: [] }, hoy)).toBeNull();
  });
});

describe('datos', () => {
  it('valida un respaldo y descarta basura', () => {
    const d = validar({ juntadas: [{ id: 'x', fecha: '2026-10-10', titulo: 'Asado', personas: [{ nombre: 'Ana', puso: 100 }, { nombre: 'Mal', puso: -5 }] }, { id: 1 }], amigos: ['Ana', 'Ana', 3], avisoDias: 999 });
    expect(d.juntadas).toHaveLength(1);
    expect(d.juntadas[0].personas.map((x) => x.nombre)).toEqual(['Ana']);
    expect(d.amigos).toEqual(['Ana']);
    expect(d.avisoDias).toBe(30);
  });
  it('recuerda amigos sin duplicar', () => {
    expect(sumarAmigos(['Jesús'], ['jesús', ' Pablo ', ''])).toEqual(['Jesús', 'Pablo']);
  });
});
