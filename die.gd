extends Node2D
class_name Die 

var letter: String:
	set(value):
		letter = value
		if is_node_ready() and $LetterDisplay:
			$LetterDisplay.text = value



func _init(letter: String):
	self.letter = letter

# Called when the node enters the scene tree for the first time.
func _ready():
	$LetterDisplay.text = letter


# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(delta):
	pass
