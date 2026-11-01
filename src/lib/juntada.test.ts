import { describe, expect, it } from 'vitest';
import { calcular, diasSinJuntarse, sumarAmigos, tocaJuntarse, validar, type Persona } from './juntada';

const p = (nombre: string, pesos: number, participa = true): Persona => ({ id: nombre, nombre, puso: Math.round(pesos * 100), participa });

describe('calculadora', () => {
  it('compraron tres y se divide entre cuatro', () => {
    const r = calcular([p('Jesús', 50000), p('Pablo', 30000), p('Ricardo', 20000), p('Nico', 0)]);
    expect(r.total).toBe(10_000_000);
    expect(r.porCabeza).toBe(2_500_000);
    expect(r.avisos).toEqual([]);
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

describe('alcohol y tiempo que estuvo', () => {
  const q = (nombre: string, pesos: number, extra: Partial<Persona> = {}): Persona => ({ ...p(nombre, pesos), ...extra });

  it('el que no toma no paga el alcohol', () => {
    // Asado $60.000 (Jesús) + cerveza $20.000 (Pablo). Nico no toma.
    const r = calcular([q('Jesús', 60000), q('Pablo', 20000, { alcohol: 2_000_000 }), q('Nico', 0, { toma: false })], true);
    expect(r.alcohol).toBe(2_000_000);
    expect(r.parte).toEqual({ Jesús: 3_000_000, Pablo: 3_000_000, Nico: 2_000_000 }); // 20.000 de comida c/u + 10.000 de alcohol los que toman
    expect(r.porCabeza).toBeNull();
    expect(Object.values(r.saldo).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('si no se separa el alcohol, todos pagan lo mismo aunque esté cargado', () => {
    const r = calcular([q('Jesús', 60000), q('Pablo', 20000, { alcohol: 2_000_000 }), q('Nico', 0, { toma: false })], false);
    expect(r.porCabeza).toBe(Math.floor(8_000_000 / 3));
    expect(r.alcohol).toBe(0);
  });

  it('el que estuvo un rato paga en proporción', () => {
    // $100.000 entre 3 completos y uno que estuvo la mitad: 100+100+100+50 = 350 partes
    const r = calcular([q('A', 100000), q('B', 0), q('C', 0), q('D', 0, { porcentaje: 50 })]);
    expect(r.parte.D).toBe(1_428_571);
    expect(r.parte.B).toBe(2_857_143);
    expect(Object.values(r.parte).reduce((a, b) => a + b, 0)).toBe(10_000_000);
  });

  it('combina las dos cosas: llegó tarde y no toma', () => {
    const r = calcular([q('A', 30000, { alcohol: 1_000_000 }), q('B', 0), q('C', 0, { porcentaje: 25, toma: false })], true);
    // comida 20.000 en 100+100+25 · alcohol 10.000 en 100+100
    expect(r.parte.C).toBe(222_222);
    expect(r.parte.A + r.parte.B + r.parte.C).toBe(3_000_000);
    expect(r.parte.A).toBe(r.parte.B);
  });

  it('alcohol cargado pero nadie toma: se reparte entre todos y avisa', () => {
    const r = calcular([q('A', 1000, { alcohol: 100_000, toma: false }), q('B', 0, { toma: false })], true);
    expect(r.avisos).toHaveLength(1);
    expect(r.parte).toEqual({ A: 50_000, B: 50_000 });
  });

  it('el alcohol nunca supera lo que puso la persona', () => {
    const r = calcular([q('A', 100, { alcohol: 999_999 }), q('B', 0, { toma: false })], true);
    expect(r.alcohol).toBe(10_000);
    expect(r.parte).toEqual({ A: 10_000, B: 0 });
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
