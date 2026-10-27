import type { Pos } from "../frontend/ast.js";
import type { ClassInfo, Type } from "./types.js";

export type SymbolKind = "variable" | "constant" | "parameter" | "function" | "class" | "catch";

export type ScopeKind = "global" | "function" | "method" | "class" | "block" | "loop" | "switch" | "catch";

export interface Sym {
  id: number;
  name: string;
  kind: SymbolKind;
  type: Type;
  mutable: boolean;
  initialized: boolean;
  pos: Pos;
  scope: Scope;
  /** Lecturas y escrituras, en el orden en que se recorren. */
  uses: Pos[];
  /** Lo usa una función distinta de la que lo declara (requiere entorno en el heap). */
  captured: boolean;
  /** Solo para símbolos de clase. */
  cls?: ClassInfo;
}

export class Scope {
  readonly symbols = new Map<string, Sym>();
  readonly children: Scope[] = [];

  constructor(
    readonly id: number,
    readonly kind: ScopeKind,
    readonly name: string,
    readonly pos: Pos,
    readonly parent?: Scope,
  ) {
    parent?.children.push(this);
  }

  lookupLocal(name: string): Sym | undefined {
    return this.symbols.get(name);
  }

  lookup(name: string): Sym | undefined {
    for (let s: Scope | undefined = this; s; s = s.parent) {
      const sym = s.symbols.get(name);
      if (sym) return sym;
    }
    return undefined;
  }

  /** Función o método que contiene este ámbito; `undefined` en código global. */
  get owner(): Scope | undefined {
    for (let s: Scope | undefined = this; s; s = s.parent) {
      if (s.kind === "function" || s.kind === "method") return s;
    }
    return undefined;
  }

  /** Primer ancestro (incluido este) del tipo pedido. */
  nearest(...kinds: ScopeKind[]): Scope | undefined {
    for (let s: Scope | undefined = this; s; s = s.parent) if (kinds.includes(s.kind)) return s;
    return undefined;
  }
}

/** Dueño de todos los ámbitos y símbolos de un programa; asigna ids deterministas. */
export class SymbolTable {
  readonly scopes: Scope[] = [];
  readonly symbols: Sym[] = [];
  readonly root: Scope;

  constructor() {
    this.root = this.open("global", "global", { line: 1, column: 1 });
  }

  open(kind: ScopeKind, name: string, pos: Pos, parent?: Scope): Scope {
    const scope = new Scope(this.scopes.length, kind, name, pos, parent);
    this.scopes.push(scope);
    return scope;
  }

  /**
   * Declara en `scope`. Si el nombre ya existe ahí, no declara nada y
   * devuelve el símbolo previo en `clash` para que el llamador reporte.
   */
  define(
    scope: Scope,
    fields: Pick<Sym, "name" | "kind" | "type" | "pos"> & Partial<Pick<Sym, "mutable" | "initialized" | "cls">>,
  ): { sym: Sym; clash?: Sym } {
    const clash = scope.lookupLocal(fields.name);
    const sym: Sym = {
      id: this.symbols.length,
      mutable: fields.kind === "variable" || fields.kind === "parameter",
      initialized: true,
      ...fields,
      scope,
      uses: [],
      captured: false,
    };
    if (clash) return { sym, clash };
    scope.symbols.set(sym.name, sym);
    this.symbols.push(sym);
    return { sym };
  }
}

/** Un uso desde `from` captura a `sym` si cruza el límite de una función no global. */
export function crossesFunction(sym: Sym, from: Scope): boolean {
  const owner = sym.scope.owner;
  return owner !== undefined && owner !== from.owner && sym.kind !== "class";
}

export const SYMBOL_KIND_LABEL: Record<SymbolKind, string> = {
  variable: "variable",
  constant: "constante",
  parameter: "parámetro",
  function: "función",
  class: "clase",
  catch: "error capturado",
};
