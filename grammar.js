/**
 * @file Arma 3 SQF Scripting Language
 * @author Cabal
 * @license MIT
 *
 * Grammar derived from https://foxhound.international/arma-3-sqf-grammar.html
 *
 *   Code        → Statement ( ';' Statement )*  |  empty
 *   Statement   → empty  |  Assignment  |  BinaryExpression
 *   Assignment  → Identifier '=' BinaryExpression
 *               | 'private' Identifier '=' BinaryExpression
 *
 *   BinaryExpression  → BinaryExpression Operator BinaryExpression
 *                     | PrimaryExpression
 *
 *   PrimaryExpression → Number | UnaryExpression | NularExpression
 *                     | Variable | String
 *                     | '{' Code '}' | '(' BinaryExpression ')'
 *                     | '[' BinaryExpression, ... ']'
 *
 *   NularExpression   → Operator
 *   UnaryExpression   → Operator PrimaryExpression
 *
 *   Variable    → Identifier
 *   Operator    → Identifier | Punctuation | Punctuation Punctuation
 *   Identifier  → ( Letter | Digit | '_' )+
 *   Number      → ( '0x' | '$' ) HexDigit+  |  FloatingPointNumber
 *   String      → " ( not " | "" )* "  |  ' ( not ' | '' )* '
 *
 * Notes:
 *   - NularExpression and Variable are syntactically identical (bare identifier).
 *     The distinction is resolved by the operator symbol table at semantic analysis.
 *   - Binary operator ambiguity (footnote 2) is resolved by the operator precedence
 *     table; all binary operators are left-associative at the same level.
 *   - Ordered alternation (footnote 3): nular then unary are tried before treating
 *     an identifier as a plain variable. In tree-sitter this falls out naturally
 *     from the grammar structure and the declared conflicts below.
 *   - 'private' used outside an assignment is the private nular operator per the
 *     spec, but is modelled as a keyword here for simplicity.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

export default grammar({
  name: "sqf",

  // Whitespace and comments are skipped between tokens.
  extras: $ => [
    /\s+/,
    $.comment,
  ],

  // 'private', 'true', 'false' are keywords and will not match as identifiers.
  word: $ => $.identifier,

  // Declare shift/reduce conflicts that arise from the grammar's ambiguity.
  // A bare identifier can be either:
  //   - a nular_expression (no argument follows), or
  //   - the operator token of a unary_expression (an argument does follow).
  // Tree-sitter prefers the longer (shift) match, giving unary_expression
  // priority when the identifier is followed by a valid primary_expression.
  conflicts: $ => [
    [$.unary_expression, $.nular_expression],
  ],

  rules: {
    // The root of every SQF file is an optional code body.
    // 'source_file' is the start rule and may match the empty string.
    source_file: $ => optional($.code),

    // Code → Statement ( ';' Statement )* | empty
    //
    // Tree-sitter prohibits non-start named rules from matching the empty string,
    // so 'code' is defined to always consume at least one token (either a
    // statement or a semicolon).  The empty-code case is handled by wrapping
    // call-sites with optional($.code).
    code: $ => choice(
      // Bare statement with no semicolons (e.g. the last expression in a block).
      $.statement,
      // One or more semicolons with optional surrounding statements.
      // This handles: ";", "stmt;", "; stmt", "stmt; stmt", "stmt; ;", etc.
      seq(
        optional($.statement),
        repeat1(seq(';', optional($.statement))),
      ),
    ),

    // Statement → empty | Assignment | BinaryExpression
    statement: $ => choice(
      $.assignment,
      $.binary_expression,
    ),

    // Assignment → Identifier '=' BinaryExpression
    //            | 'private' Identifier '=' BinaryExpression
    //
    // '=' (single equals) only appears here; it is not a binary_operator,
    // which prevents it conflicting with the '==' comparison operator.
    assignment: $ => choice(
      seq(
        field('variable', $.identifier),
        '=',
        field('value', $.binary_expression),
      ),
      seq(
        'private',
        field('variable', $.identifier),
        '=',
        field('value', $.binary_expression),
      ),
    ),

    // BinaryExpression → BinaryExpression Operator BinaryExpression
    //                  | PrimaryExpression
    //
    // All binary operators share the same precedence and are left-associative
    // (per the operator precedence table referenced in footnote 2).
    binary_expression: $ => choice(
      prec.left(1, seq(
        field('left', $.binary_expression),
        field('operator', $.binary_operator),
        field('right', $.binary_expression),
      )),
      $.primary_expression,
    ),

    // PrimaryExpression → Number | UnaryExpression | NularExpression | Variable
    //                   | String | '(' BinaryExpression ')'
    //                   | '{' Code '}' | '[' BinaryExpression, ... ']'
    //
    // Per footnote 3, nular then unary operators are tried before treating an
    // identifier as a variable.  NularExpression and Variable are syntactically
    // the same (both are bare identifiers), so they are unified as nular_expression.
    primary_expression: $ => choice(
      $.number,
      $.string,
      $.boolean,
      $.unary_expression,
      $.nular_expression,
      seq('(', $.binary_expression, ')'),
      $.code_block,
      $.array,
    ),

    // UnaryExpression → Operator PrimaryExpression
    //
    // Operator can be either a word (identifier) or punctuation ('!', '-', '+').
    // Punctuation unary operators are given higher precedence so that e.g.
    // '-5' is unambiguously a unary negation and not confused for a minus sign.
    unary_expression: $ => choice(
      // Word-based unary command: hint _x, call {}, if (_cond), …
      seq(
        field('operator', $.identifier),
        field('argument', $.primary_expression),
      ),
      // Punctuation-prefix unary: !_x, -5, +_x
      prec(3, seq(
        field('operator', choice('!', '-', '+')),
        field('argument', $.primary_expression),
      )),
    ),

    // NularExpression / Variable → Operator (bare identifier, no argument)
    nular_expression: $ => $.identifier,

    // '{' Code '}' — inline code block / lambda
    code_block: $ => seq('{', optional($.code), '}'),

    // '[' BinaryExpression (',' BinaryExpression)* ']' — array literal
    // Empty arrays '[]' are valid.
    array: $ => seq(
      '[',
      optional(seq(
        $.binary_expression,
        repeat(seq(',', $.binary_expression)),
      )),
      ']',
    ),

    // Binary operators: named word commands or symbolic punctuation pairs.
    // Operator → Identifier | Punctuation | Punctuation Punctuation
    binary_operator: $ => choice(
      $.identifier,   // named binary commands: select, addTo, execVM, mod, …
      '+',            // addition / string concatenation
      '-',            // subtraction
      '*',            // multiplication
      '/',            // division
      '%',            // modulo (also: 'mod' identifier form)
      '^',            // power
      '==',           // equality
      '!=',           // inequality
      '<=',           // less-or-equal
      '>=',           // greater-or-equal
      '<',            // less-than
      '>',            // greater-than
      '&&',           // logical and (also: 'and' identifier form)
      '||',           // logical or  (also: 'or'  identifier form)
      '>>',           // config namespace descendant
      '#',            // array / config element selection
      ':',            // switch-case separator: case 123: { … }
    ),

    // SQF boolean literals.  Semantically they are nular commands, but
    // distinguishing them as their own node type aids syntax highlighting.
    boolean: $ => choice('true', 'false'),

    // Identifier: the base token for variable names and word-based operators.
    // Spec: (Letter | Digit | '_')+
    // Note: identifiers that begin with a digit are shadowed by the number rule
    // in expression context, so we restrict the leading character to [a-zA-Z_].
    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*/,

    // Number → ('0x' | '$') HexDigit+  |  FloatingPointNumber
    // SQF accepts both 0x and $ as hex prefixes.
    number: $ => token(choice(
      /0x[0-9a-fA-F]+/,                    // hex: 0xFF
      /\$[0-9a-fA-F]+/,                    // hex: $FF  (SQF-specific prefix)
      /(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/,  // decimal: 1  1.5  .5  1e3  1.5e-2
    )),

    // String → " (not " | "")* "  |  ' (not ' | '')* '
    // Quote characters are escaped by doubling: "" inside "…" and '' inside '…'.
    string: $ => token(choice(
      /"([^"]|"")*"/,
      /'([^']|'')*'/,
    )),

    // Comments: C-style line (//) and block (/* … */).
    comment: $ => token(choice(
      /\/\/.*/,
      /\/\*[^*]*\*+([^/*][^*]*\*+)*\//,
    )),
  },
});
