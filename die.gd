extends Button
class_name Die 



var letter: String:
	set(value):
		letter = value
		if is_node_ready() and $LetterDisplay:
			$LetterDisplay.text = value
	get():
		return letter



func _init(letter: String = ""):
	self.letter = letter

# Called when the node enters the scene tree for the first time.
func _ready():
	#$LetterDisplay.text = letter
	pass


# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(delta):
	pass
