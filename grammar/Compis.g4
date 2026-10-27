grammar Compis;

// ---------- Programa y sentencias ----------

program : stmt* EOF ;

stmt
    : varDecl                                                         # VarStmt
    | constDecl                                                       # ConstStmt
    | funcDecl                                                        # FuncStmt
    | classDecl                                                       # ClassStmt
    | PRINT LPAREN expr RPAREN SEMI                                   # PrintStmt
    | block                                                           # BlockStmt
    | IF LPAREN expr RPAREN block (ELSE block)?                       # IfStmt
    | WHILE LPAREN expr RPAREN block                                  # WhileStmt
    | DO block WHILE LPAREN expr RPAREN SEMI                          # DoWhileStmt
    | FOR LPAREN forInit? SEMI expr? SEMI expr? RPAREN block          # ForStmt
    | FOREACH LPAREN ID IN expr RPAREN block                          # ForeachStmt
    | TRY block CATCH LPAREN ID RPAREN block                          # TryStmt
    | SWITCH LPAREN expr RPAREN LBRACE caseClause* defaultClause? RBRACE # SwitchStmt
    | BREAK SEMI                                                      # BreakStmt
    | CONTINUE SEMI                                                   # ContinueStmt
    | RETURN expr? SEMI                                               # ReturnStmt
    | expr SEMI                                                       # ExprStmt
    ;

block : LBRACE stmt* RBRACE ;

varDecl   : bindingHead (ASSIGN expr)? SEMI ;
constDecl : CONST ID typeAnn? ASSIGN expr SEMI ;
bindingHead : (LET | VAR) ID typeAnn? ;

funcDecl : FUNCTION ID LPAREN paramList? RPAREN typeAnn? block ;
paramList : param (COMMA param)* ;
param : ID typeAnn? ;

classDecl : CLASS ID (COLON ID)? LBRACE classMember* RBRACE ;
classMember : varDecl | constDecl | funcDecl ;

forInit
    : bindingHead (ASSIGN expr)?    # ForDeclInit
    | expr                          # ForExprInit
    ;

caseClause    : CASE expr COLON stmt* ;
defaultClause : DEFAULT COLON stmt* ;

typeAnn : COLON typeRef ;
typeRef : baseType (LBRACKET RBRACKET)* ;
baseType : BOOLEAN | INTEGER | FLOAT | STRING | ID ;

// ---------- Expresiones ----------

expr
    : <assoc=right> target ASSIGN expr          # AssignExpr
    | binary (QUESTION expr COLON expr)?        # CondExpr
    ;

// Precedencia: la primera alternativa recursiva liga más fuerte.
binary
    : op=(MINUS | NOT) binary                   # Prefix
    | binary op=(STAR | SLASH | PERCENT) binary # Infix
    | binary op=(PLUS | MINUS) binary           # Infix
    | binary op=(LT | LTE | GT | GTE) binary    # Infix
    | binary op=(EQUAL | NOT_EQUAL) binary      # Infix
    | binary op=AND binary                      # Infix
    | binary op=OR binary                       # Infix
    | primary                                   # Atom
    ;

primary
    : literal                   # LiteralPrimary
    | target                    # TargetPrimary
    | LPAREN expr RPAREN        # ParenPrimary
    ;

target : head suffix* ;

head
    : ID                                # NameHead
    | THIS                              # ThisHead
    | NEW ID LPAREN argList? RPAREN     # NewHead
    ;

suffix
    : LPAREN argList? RPAREN            # CallSuffix
    | LBRACKET expr RBRACKET            # IndexSuffix
    | DOT ID                            # MemberSuffix
    ;

argList : expr (COMMA expr)* ;

literal
    : INT_LIT
    | FLOAT_LIT
    | STRING_LIT
    | TRUE
    | FALSE
    | NULL
    | LBRACKET (expr (COMMA expr)*)? RBRACKET
    ;

// ---------- Léxico ----------

LET      : 'let' ;
VAR      : 'var' ;
CONST    : 'const' ;
FUNCTION : 'function' ;
CLASS    : 'class' ;
PRINT    : 'print' ;
IF       : 'if' ;
ELSE     : 'else' ;
WHILE    : 'while' ;
DO       : 'do' ;
FOR      : 'for' ;
FOREACH  : 'foreach' ;
IN       : 'in' ;
BREAK    : 'break' ;
CONTINUE : 'continue' ;
RETURN   : 'return' ;
TRY      : 'try' ;
CATCH    : 'catch' ;
SWITCH   : 'switch' ;
CASE     : 'case' ;
DEFAULT  : 'default' ;
NEW      : 'new' ;
THIS     : 'this' ;
TRUE     : 'true' ;
FALSE    : 'false' ;
NULL     : 'null' ;
BOOLEAN  : 'boolean' ;
INTEGER  : 'integer' ;
FLOAT    : 'float' ;
STRING   : 'string' ;

OR        : '||' ;
AND       : '&&' ;
EQUAL     : '==' ;
NOT_EQUAL : '!=' ;
LTE       : '<=' ;
GTE       : '>=' ;
LT        : '<' ;
GT        : '>' ;
ASSIGN    : '=' ;
PLUS      : '+' ;
MINUS     : '-' ;
STAR      : '*' ;
SLASH     : '/' ;
PERCENT   : '%' ;
NOT       : '!' ;
QUESTION  : '?' ;
COLON     : ':' ;
DOT       : '.' ;
COMMA     : ',' ;
SEMI      : ';' ;
LPAREN    : '(' ;
RPAREN    : ')' ;
LBRACE    : '{' ;
RBRACE    : '}' ;
LBRACKET  : '[' ;
RBRACKET  : ']' ;

FLOAT_LIT  : DIGIT+ '.' DIGIT+ ;
INT_LIT    : DIGIT+ ;
STRING_LIT : '"' (ESCAPE | ~["\\\r\n])* '"' ;
// Cadena mal formada (sin cierre o con escape inválido); el driver la reporta.
BAD_STRING : '"' ('\\' ~[\r\n] | ~["\\\r\n])* '"'? ;
ID         : [a-zA-Z_] [a-zA-Z0-9_]* ;

WS            : [ \t\r\n]+ -> skip ;
LINE_COMMENT  : '//' ~[\r\n]* -> skip ;
BLOCK_COMMENT : '/*' .*? '*/' -> skip ;

// Cualquier otro carácter; el driver lo convierte en error léxico.
ERROR_CHAR : . ;

fragment DIGIT  : [0-9] ;
fragment ESCAPE : '\\' ["\\nrt] ;
