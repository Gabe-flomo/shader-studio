/** A built-in GLSL function/constant, offered as an insertable snippet in
 * expression fields (desktop's Expr Block modal palette, mobile's inline
 * autocomplete). `label` is what's shown; `insert` is what gets typed —
 * usually the same text with empty parens ready for arguments. */
export interface GlslPaletteEntry { label: string; insert: string; group: string; }

export const GLSL_PALETTE: GlslPaletteEntry[] = [
  { group: 'Trig',      label: 'sin(f)',            insert: 'sin()'                },
  { group: 'Trig',      label: 'cos(f)',            insert: 'cos()'                },
  { group: 'Trig',      label: 'atan(f,f)',          insert: 'atan(, )'             },
  { group: 'Exp/Log',   label: 'exp(f)',             insert: 'exp()'                },
  { group: 'Exp/Log',   label: 'sqrt(f)',            insert: 'sqrt()'               },
  { group: 'Exp/Log',   label: 'pow(f,f)',           insert: 'pow(, )'              },
  { group: 'Rounding',  label: 'floor(f)',           insert: 'floor()'              },
  { group: 'Rounding',  label: 'ceil(f)',            insert: 'ceil()'               },
  { group: 'Rounding',  label: 'fract(f)',           insert: 'fract()'              },
  { group: 'Math',      label: 'abs(f)',             insert: 'abs()'                },
  { group: 'Math',      label: 'mod(f,f)',           insert: 'mod(, )'              },
  { group: 'Math',      label: 'min(f,f)',           insert: 'min(, )'              },
  { group: 'Math',      label: 'max(f,f)',           insert: 'max(, )'              },
  { group: 'Math',      label: 'clamp(f,f,f)',       insert: 'clamp(, , )'          },
  { group: 'Math',      label: 'mix(f,f,f)',         insert: 'mix(, , )'            },
  { group: 'Math',      label: 'smoothstep(f,f,f)',  insert: 'smoothstep(, , )'     },
  { group: 'Vector',    label: 'length(v)',          insert: 'length()'             },
  { group: 'Vector',    label: 'normalize(v)',       insert: 'normalize()'          },
  { group: 'Vector',    label: 'dot(v,v)',           insert: 'dot(, )'              },
  { group: 'Vector',    label: 'vec2(f,f)',          insert: 'vec2(, )'             },
  { group: 'Vector',    label: 'vec3(f,f,f)',        insert: 'vec3(, , )'           },
  { group: 'Custom',    label: 'palette(f,v3×4)',    insert: 'palette(, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0,0.33,0.67))' },
  { group: 'Custom',    label: 'rotate(v2,f)',       insert: 'rotate(, )'           },
  { group: 'SDF',       label: 'sdBox(v2,v2)',       insert: 'sdBox(, )'            },
  { group: 'SDF',       label: 'sdSegment(v2,v2,v2)',insert: 'sdSegment(, , )'      },
  { group: 'SDF',       label: 'sdEllipse(v2,v2)',   insert: 'sdEllipse(, )'        },
  { group: 'SDF',       label: 'opRepeat(v2,f)',     insert: 'opRepeat(, )'         },
  { group: 'Constants', label: 'PI',                insert: 'PI'                   },
  { group: 'Constants', label: 'TAU',               insert: 'TAU'                  },
  { group: 'Constants', label: 'u_time',            insert: 'u_time'               },
];
