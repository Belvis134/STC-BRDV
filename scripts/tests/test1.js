let guesser_data = {'answer': {'metro': {'question_num':'80','city':'Mecca','line1':'S','line2':'Al Mashaaer Al Mugaddassah','line_col':'pink','degree': '150', 'difficulty': 'hard','modifier': 'RW','guessers': {}}}}

// console.log(calc_points('metro', 70, '<@587949455429337098>'))
// console.log(calc_points('metro', 200, '<@489372949237984899>'))
// console.log(calc_points('metro', 70, '<@139283091803091890>'))
// console.log(guesser_data.answer.metro.guessers['<@587949455429337098>'].attributes)
// console.log(guesser_data.answer.metro.guessers['<@489372949237984899>'].attributes)
// console.log(guesser_data.answer.metro.guessers['<@139283091803091890>'].attributes)
// announce_and_reset_answer('metro')
check_ans('Al Mugadass', 'Al Mashaaer Al Mugaddassah', 2, 0.7, '<@587949455429337098>')

function calc_points(type, degree, user) {
  const correct_ans = guesser_data.answer[type];
  let points = 0
  if (type === 'bus') {
    // bus_geoguessr points calculation
  } else if (type === 'metro') {
    const difficulty_points = {"easy": 5, "medium": 10, "hard": 20}
    init_guesser_data(user, correct_ans)
    var ans_attributes = correct_ans.guessers[user].attributes;
    const modifier = correct_ans.modifier
    if (correct_ans.difficulty) {
      points = difficulty_points[correct_ans.difficulty]
    } else if (typeof(correct_ans.points) === 'number') {
      points = correct_ans.points
    }
    if (Object.keys(correct_ans.guessers).length === 1) {
      points = points + 5
      ans_attributes.add('first')
    } else {
			if (modifier === "NCM") {
				points = points + 10
				ans_attributes.add('normal')
			} else if (modifier === "NSF") {
				points = points + 5
				ans_attributes.add('normal')
			} 
		}
		if (modifier === "RW" && degree !== null && correct_ans.degree !== null) {
      if (degree <= Math.round(correct_ans.degree) + 30 && degree >= Math.round(correct_ans.degree - 30)) {
        points = points + 10
        ans_attributes.add('RW_10')
      } else if (degree <= Math.round(correct_ans.degree) + 60 && degree >= Math.round(correct_ans.degree - 60)) {
        points = points + 5
        ans_attributes.add('RW_5')
      } else {
				if (!ans_attributes.has('first')) {
					ans_attributes.add('normal')
				}
			}
    }
  } else if (type === 'metro_hard') {
    // Hard metro_guesser points calculation
  }
  correct_ans.guessers[user].attributes = Array.from(ans_attributes);
  return points
}

function init_guesser_data(user_id, answer_obj) {
  if (!(user_id in answer_obj.guessers)) {
    answer_obj.guessers[user_id] = { attributes: new Set(), guesses: 0 };
  }
  if (!(answer_obj.guessers[user_id].attributes instanceof Set)) {
    answer_obj.guessers[user_id].attributes = new Set();
  }
  if (typeof answer_obj.guessers[user_id].guesses !== 'number') {
    answer_obj.guessers[user_id].guesses = 0;
  }
}

function check_ans(input_ans, correct_ans, part_length, thr = 0.7, user) {
  // Trim whitespace + trim double space
  input_ans = input_ans.trim().replace(/\s+/g, ' ')
  // Split the answer into an array with each index split by " "
  const answer_list = correct_ans?.toLowerCase().split(" ") ?? [];
  // Split the input into an array with each index split by " "
  const input_list = input_ans?.toLowerCase().split(" ") ?? [];

  // If "line" is included as the first or last word, then ignore
  if (input_list.at(-1) === 'line') input_list.pop();
  if (input_list[0] === 'line') input_list.shift();
  if (answer_list.at(-1) === 'line') answer_list.pop();
  if (answer_list[0] === 'line') answer_list.shift();

  // Check if the consecutive indices is "n", if so consecutive indices is the length of the correct answer
  if (part_length === 0) part_length = answer_list.length;

  // Check if the input and correct answer has at least part_length number of consecutive indices
  if (answer_list.length < part_length) {
    return `Your minimum consecutive words number is longer than the length of the correct answer that you set! The answer you set is ${answer_list.length} words long, without counting the word 'line' at the front and/or back!`;
  }

  // Generate all valid consecutive indices of the array (length >= part_length)
  const valid_ans = new Set();
  for (let start = 0; start < answer_list.length; start++) {
    for (let end = start + part_length; end <= answer_list.length; end++) {
      const ans = answer_list.slice(start, end).join(' ');
      valid_ans.add(ans);
    }
  }

  // Check if any valid sequence matches the input string exactly.
  const input_str = input_list.join(' ');
  if (valid_ans.has(input_str)) return true;

  // If there is a spelling mistake, then...
  const candidates = Array.from(valid_ans);
	let coefficients = []
	for (let k = 0; k < candidates.length; k++) {
		coefficients.push(levenshtein_coefficient(input_str, candidates[k]))
	};
	const best_match_rating = Math.max(...coefficients)
	const best_match_str = candidates[coefficients.indexOf(best_match_rating)]

  // Word-by-word similarity comparison
  const match_words = best_match_str.split(' ');
  if (input_list.length !== match_words.length) return false;

  let total_score = 0;
  for (let i = 0; i < input_list.length; i++) {
    const word_score = levenshtein_coefficient(input_list[i], match_words[i]);
    total_score += word_score;
  }
  // Console log
  const avg_score = total_score / input_list.length;
  console.log([
		`===== User Guess =====`,
		`User: ${user}`,
		`User input: "${input_ans.toLowerCase()}"`,
		`Correct answer: "${correct_ans.toLowerCase()}"`,
		`Average similarity score by word: ${avg_score}`,
		`Overall similarity score: ${best_match_rating}`,
		`Consecutive word length: ${part_length}`,
		`======================`].join(`\n`))
  return avg_score >= thr;
}

async function announce_and_reset_answer(type) { 
  const correct_ans = guesser_data.answer[type];
  const modifier = correct_ans.modifier;
  const guessers = correct_ans.guessers;

	if (type === 'metro') {
		const difficulty_points = {'easy': 5, 'medium': 10, 'hard': 20};
		const pre_line1 = correct_ans.line1?.split(' ') ?? [];
		if (pre_line1[0]?.toLowerCase() === 'line') pre_line1.shift();
		if (pre_line1.at(-1)?.toLowerCase() === 'line') pre_line1.pop();
		const line1 = pre_line1.join(' ');
		const pre_line2 = correct_ans.line2?.split(' ') ?? [];
		if (pre_line2[0]?.toLowerCase() === 'line') pre_line2.shift();
		if (pre_line2.at(-1)?.toLowerCase() === 'line') pre_line2.pop();
		const line2 = pre_line2.join(' ');

		let summary = `#${correct_ans.question_num} is the **${correct_ans.city} Line ${line1}**${correct_ans.line2 ? ` or the **${line2} line**` : ''}${correct_ans.line_col ? ` or the **${correct_ans.line_col} line**` : ``}!\n\n`;
		if (correct_ans.degree !== null) summary += `Rotation angle: **${correct_ans.degree}°**\n\n`;

		if (Object.entries(guessers).length === 0) {
			summary += 'How did no one get this correct sia...';
		} else {
			const modifier_bonus_points = {'NCM': 10, 'NSF': 5};
			summary += `${modifier !== null ? `Modifier today is **${modifier}** (+${modifier === 'RW' ? '5/10' : `${modifier_bonus_points[modifier]}`} pts).` : `No modifiers today.`} Difficulty is **${correct_ans.difficulty}** (${difficulty_points[correct_ans.difficulty]} base points)\n\nMetroguessed by:\n\n`;
			const first = users_with_attribute('metro', 'first');
			if (first.length) {
				summary += `**First to answer** (+5 bonus): ${first}\n\n`;
			}
			if (modifier === 'RW') {
				const rw10 = users_with_attribute('metro', 'RW_10');
				const rw5 = users_with_attribute('metro', 'RW_5')
				if (rw10.length) {
					summary += `**Guessed within ±30°** (+10 bonus):\n${rw10.join('\n')}\n\n`;
				}
				if (rw5.length) {
					summary += `**Guessed within ±60°** (+5 bonus):\n${rw5.join('\n')}\n\n`;
				}
			}
			const normals = users_with_attribute('metro', 'normal');
			if (normals.length) {
				summary += `Others who got it correct:\n${normals.join('\n')}`;
			}
		}

		console.log(summary);
	}
}

function users_with_attribute(type, attribute) {
  const data = guesser_data.answer[type].guessers
  return Object.entries(data)
    .filter(([name, details]) => details.attributes.includes(attribute))
    .map(([name]) => name); // Return only the user names
};

function levenshtein_coefficient(input_ans, correct_ans, thr) {
  // Levenshtein matrix
  const matrix = Array.from({ length: input_ans.length + 1 }, (_, i) =>
    Array.from({ length: correct_ans.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  // Levenshtein calculations
  for (let i = 1; i <= input_ans.length; i++) {
    for (let j = 1; j <= correct_ans.length; j++) {
      const cost = input_ans[i - 1] === correct_ans[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // Deletion
        matrix[i][j - 1] + 1, // Insertion
        matrix[i - 1][j - 1] + cost // Substitution
      );
    }
  }
  const levenshtein_dist = matrix[input_ans.length][correct_ans.length]
  // Return Levenshtein coefficient
  return 1 - (levenshtein_dist/input_ans.length);
}