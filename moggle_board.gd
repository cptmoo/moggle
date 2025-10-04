extends Node2D

var size : Vector2i = Vector2i(4,4)

var dice_letters: Array = ['AAEEGN', 'ABBJOO', 'ACHOPS', 'AFFKPS', 'AOOTTW', 'CIMOTU', 'DEILRX', 'DELRVY', 'DISTTY', 'EEGHNW', 'EEINSU', 'EHRTVW', 'EIOSST', 'ELRTTY', 'HIMNU1', 'HLNNRZ']
@onready var ts : TileMapLayer = $DiceBoard
#var dice: Arra
# Called when the node enters the scene tree for the first time.
func _ready():
	print(dice_letters[3])
	print(ts.get_used_cells())

# Called every frame. 'delta' is the elapsed time since the previous frame.
func _process(delta):
	pass

func set_letters():
	pass
	
