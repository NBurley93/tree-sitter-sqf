;; Highlights for SQF

;; Possible nodes:
;; comment
;; identifier
;; string
;; number
;; boolean
;; unary_expression
;; nular_expression

(comment) @comment


;; Highlights keywords
; (keyword) @keyword

(identifier) @keyword

;; String literals
(string) @string

;; Numbers & Boolean
(boolean) @number
(number) @number

;; Other text nodes
(assignment) @property
(code) @property
